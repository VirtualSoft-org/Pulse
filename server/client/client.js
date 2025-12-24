/** WebRTC Client - Browser Demo */

const SUPABASE_URL = 'https://enbyfbrgnyfbfbrqpxos.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q'

let supabase = null
let myUserId = null
let roomId = '95552244-2f21-4f86-8cdc-417efc600b99'
let pc = null
let dataChannel = null
let signalingCallback = null
let hostId = null

const logEl = document.getElementById('log')
const msgInput = document.getElementById('msg')
const sendBtn = document.getElementById('send')
const connectBtn = document.getElementById('connect')
const statusEl = document.getElementById('status')

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`
  logEl.value += line
  logEl.scrollTop = logEl.scrollHeight
}

async function initSupabase() {
  const { createClient } = window.supabase
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  
  // Authenticate
  const { error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  
  const { data } = await supabase.auth.getUser()
  myUserId = data.user.id
  log(`✅ Authenticated as ${myUserId.substring(0, 8)}...`)
  
  // Join room
  const { error: joinError } = await supabase
    .from('room_members')
    .insert({ room_id: roomId, user_id: myUserId })
  if (joinError && !joinError.message.includes('duplicate')) throw joinError
  
  log(`✅ Joined room ${roomId.substring(0, 8)}...`)
  statusEl.textContent = '🟡 Waiting for host...'
}

async function initSignaling() {
  // Subscribe to signaling channel
  const channel = supabase.channel(`room:${roomId}:signaling`)
  
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const msg = payload
    // Only process messages addressed to us
    if (msg.to === myUserId && msg.from !== myUserId) {
      log(`📡 Signal from ${msg.from.substring(0, 8)}...: ${msg.type}`)
      if (signalingCallback) {
        signalingCallback(msg)
      }
    }
  }).subscribe()
  
  log('🔊 Signaling ready')
}

async function sendSignal(to, type, data) {
  const msg = { from: myUserId, to, type, data }
  const { error } = await supabase.channel(`room:${roomId}:signaling`).send('broadcast', msg)
  if (error) log(`❌ Signal send failed: ${error.message}`)
}

async function createPeerConnection(hostIdParam) {
  hostId = hostIdParam
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  })
  
  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(hostId, 'ice', event.candidate)
    }
  }
  
  // Handle remote data channel
  pc.ondatachannel = (event) => {
    dataChannel = event.channel
    setupDataChannel()
  }
  
  // Setup signal handler
  signalingCallback = async (msg) => {
    if (msg.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.data))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await sendSignal(hostId, 'answer', answer)
    } else if (msg.type === 'ice') {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.data))
      } catch (e) {
        // Ignore
      }
    }
  }
}

function setupDataChannel() {
  dataChannel.onopen = () => {
    log(`✅ Connected to host`)
    statusEl.textContent = '🟢 Connected'
    statusEl.classList.add('connected')
    msgInput.disabled = false
    sendBtn.disabled = false
  }
  
  dataChannel.onmessage = (event) => {
    log(`📬 Host: ${event.data}`)
  }
  
  dataChannel.onclose = () => {
    log(`❌ Connection closed`)
    statusEl.textContent = '🔴 Disconnected'
    statusEl.classList.remove('connected')
    msgInput.disabled = true
    sendBtn.disabled = true
  }
}

async function start() {
  try {
    connectBtn.disabled = true
    log('Initializing...')
    await initSupabase()
    await initSignaling()
    
    // Find host (first user in room)
    const { data: members } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .order('user_id', { ascending: true })
    
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error('No peers in room')
    }
    
    const potentialHost = members[0].user_id
    if (potentialHost === myUserId) {
      log('⚠️ No host found, waiting...')
      return
    }
    
    await createPeerConnection(potentialHost)
    log(`🔗 Connecting to host ${potentialHost.substring(0, 8)}...`)
    log('🎉 Ready - waiting for host connection')
  } catch (err) {
    log(`❌ Error: ${err.message}`)
    connectBtn.disabled = false
  }
}

sendBtn.onclick = () => {
  const msg = msgInput.value.trim()
  if (!msg) return
  
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(msg)
    log(`📤 You: ${msg}`)
    msgInput.value = ''
  } else {
    log('❌ Not connected')
  }
}

connectBtn.onclick = start

// Initially disable send button
msgInput.disabled = true
sendBtn.disabled = true

// Check if Supabase is available
window.addEventListener('load', () => {
  if (!window.supabase) {
    log('❌ Supabase library not loaded')
  }
})

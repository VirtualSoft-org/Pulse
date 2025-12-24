/** WebRTC Host - Browser Demo */

const SUPABASE_URL = 'https://enbyfbrgnyfbfbrqpxos.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q'

let supabase = null
let myUserId = null
let roomId = '95552244-2f21-4f86-8cdc-417efc600b99'
let peers = new Map() // Map of peerId -> RTCPeerConnection
let dataChannels = new Map() // Map of peerId -> RTCDataChannel
let signalingCallbacks = {}

const logEl = document.getElementById('log')
const msgInput = document.getElementById('msg')
const sendBtn = document.getElementById('send')
const connectBtn = document.getElementById('connect')
const statusEl = document.getElementById('status')
const peerListEl = document.getElementById('peerList')

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
  statusEl.textContent = '🟢 Connected (Host)'
  statusEl.classList.add('connected')
}

async function initSignaling() {
  // Subscribe to signaling channel
  const channel = supabase.channel(`room:${roomId}:signaling`)
  
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const msg = payload
    // Only process messages addressed to us
    if (msg.to === myUserId && msg.from !== myUserId) {
      log(`📡 Signal from ${msg.from.substring(0, 8)}...: ${msg.type}`)
      if (signalingCallbacks[msg.from]) {
        signalingCallbacks[msg.from](msg)
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

async function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  })
  
  // Setup data channel
  const dc = pc.createDataChannel('data', { ordered: true })
  setupDataChannel(dc, peerId)
  dataChannels.set(peerId, dc)
  
  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal(peerId, 'ice', event.candidate)
    }
  }
  
  // Handle remote data channel
  pc.ondatachannel = (event) => {
    setupDataChannel(event.channel, peerId)
    dataChannels.set(peerId, event.channel)
  }
  
  // Setup signal handler
  signalingCallbacks[peerId] = async (msg) => {
    if (msg.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.data))
    } else if (msg.type === 'ice') {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.data))
      } catch (e) {
        // Ignore
      }
    }
  }
  
  peers.set(peerId, pc)
  return pc
}

function setupDataChannel(dc, peerId) {
  dc.onopen = () => {
    log(`✅ DataChannel open with ${peerId.substring(0, 8)}...`)
    updatePeerList()
  }
  
  dc.onmessage = (event) => {
    log(`💬 ${peerId.substring(0, 8)}...: ${event.data}`)
  }
  
  dc.onclose = () => {
    log(`❌ DataChannel closed with ${peerId.substring(0, 8)}...`)
    updatePeerList()
  }
}

async function connectToPeer(peerId) {
  if (peers.has(peerId)) return
  
  log(`🔗 Connecting to ${peerId.substring(0, 8)}...`)
  const pc = await createPeerConnection(peerId)
  
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  await sendSignal(peerId, 'offer', offer)
}

function updatePeerList() {
  peerListEl.innerHTML = ''
  for (const [peerId, dc] of dataChannels.entries()) {
    if (dc.readyState === 'open') {
      const li = document.createElement('li')
      li.textContent = `✅ ${peerId.substring(0, 8)}...`
      peerListEl.appendChild(li)
    }
  }
}

async function start() {
  try {
    connectBtn.disabled = true
    log('Initializing...')
    await initSupabase()
    await initSignaling()
    
    // Discover peers in room
    const { data: members } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
    
    if (Array.isArray(members)) {
      for (const m of members) {
        if (m.user_id !== myUserId) {
          await new Promise(r => setTimeout(r, 500))
          await connectToPeer(m.user_id)
        }
      }
    }
    
    log('🎉 Ready to send messages')
  } catch (err) {
    log(`❌ Error: ${err.message}`)
    connectBtn.disabled = false
  }
}

sendBtn.onclick = () => {
  const msg = msgInput.value.trim()
  if (!msg) return
  
  let sent = 0
  for (const [peerId, dc] of dataChannels.entries()) {
    if (dc.readyState === 'open') {
      dc.send(msg)
      sent++
    }
  }
  
  if (sent > 0) {
    log(`📤 Broadcast to ${sent} peer(s): ${msg}`)
    msgInput.value = ''
  } else {
    log('❌ No connected peers')
  }
}

connectBtn.onclick = start

// Check if Supabase is available
window.addEventListener('load', () => {
  if (!window.supabase) {
    log('❌ Supabase library not loaded')
  }
})

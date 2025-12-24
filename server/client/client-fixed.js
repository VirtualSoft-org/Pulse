/** WebRTC Client - Browser Demo (Fixed) */

const SUPABASE_URL = 'https://enbyfbrgnyfbfbrqpxos.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q'

let supabase = null
let myUserId = null
let roomId = '95552244-2f21-4f86-8cdc-417efc600b99'
let pc = null
let dataChannel = null
let signalingCallback = null
let hostId = null

let logEl, msgInput, sendBtn, connectBtn, statusEl

function log(msg) {
  if (!logEl) return
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`
  logEl.value += line
  logEl.scrollTop = logEl.scrollHeight
  console.log(msg)
}

async function ensureSupabase() {
  if (window.supabase) return
  log('⏳ Waiting for Supabase...')
  await new Promise(r => setTimeout(r, 500))
  return ensureSupabase()
}

async function initSupabase() {
  await ensureSupabase()
  const { createClient } = window.supabase
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  
  const { error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  
  const { data } = await supabase.auth.getUser()
  myUserId = data.user.id
  log(`✅ Auth: ${myUserId.substring(0, 8)}...`)
  
  const { error: joinError } = await supabase
    .from('room_members')
    .insert({ room_id: roomId, user_id: myUserId })
  if (joinError && !joinError.message.includes('duplicate')) throw joinError
  
  log(`✅ Joined room`)
  statusEl.textContent = '🟡 Waiting for host...'
}

async function initSignaling() {
  const channel = supabase.channel(`room:${roomId}:signaling`)
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const msg = payload
    if (msg.to === myUserId && msg.from !== myUserId) {
      log(`📡 ${msg.type}`)
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
  if (error) log(`Error: ${error.message}`)
}

async function createPeerConnection(hostIdParam) {
  hostId = hostIdParam
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  })
  
  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal(hostId, 'ice', event.candidate)
  }
  
  pc.ondatachannel = (event) => {
    dataChannel = event.channel
    setupDataChannel()
  }
  
  signalingCallback = async (msg) => {
    try {
      if (msg.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await sendSignal(hostId, 'answer', answer)
      } else if (msg.type === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(msg.data))
      }
    } catch (e) {
      console.error(e)
    }
  }
}

function setupDataChannel() {
  dataChannel.onopen = () => {
    log(`✅ Connected!`)
    statusEl.textContent = '🟢 Connected'
    statusEl.classList.add('connected')
    msgInput.disabled = false
    sendBtn.disabled = false
  }
  
  dataChannel.onmessage = (event) => {
    log(`📬 Host: ${event.data}`)
  }
  
  dataChannel.onclose = () => {
    log(`Disconnected`)
    statusEl.textContent = '🔴 Disconnected'
    statusEl.classList.remove('connected')
    msgInput.disabled = true
    sendBtn.disabled = true
  }
}

async function start() {
  try {
    connectBtn.disabled = true
    log('Starting...')
    await initSupabase()
    await initSignaling()
    
    const { data: members } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .order('user_id', { ascending: true })
    
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error('No peers')
    }
    
    const potentialHost = members[0].user_id
    if (potentialHost === myUserId) {
      log('No host found')
      return
    }
    
    await createPeerConnection(potentialHost)
    log(`Connecting to host...`)
  } catch (err) {
    log(`Error: ${err.message}`)
    connectBtn.disabled = false
  }
}

function init() {
  logEl = document.getElementById('log')
  msgInput = document.getElementById('msg')
  sendBtn = document.getElementById('send')
  connectBtn = document.getElementById('connect')
  statusEl = document.getElementById('status')
  
  if (!logEl) {
    setTimeout(init, 100)
    return
  }
  
  connectBtn.onclick = start
  sendBtn.onclick = () => {
    const msg = msgInput.value.trim()
    if (!msg) return
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(msg)
      log(`You: ${msg}`)
      msgInput.value = ''
    } else {
      log('Not connected')
    }
  }
}

document.addEventListener('DOMContentLoaded', init)

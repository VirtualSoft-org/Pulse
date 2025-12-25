/** WebRTC Host - Browser Demo (Fixed) */

const SUPABASE_URL = 'https://enbyfbrgnyfbfbrqpxos.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q'

let supabase = null
let myUserId = null
let roomId = '95552244-2f21-4f86-8cdc-417efc600b99'
let peers = new Map()
let dataChannels = new Map()
let signalingCallbacks = {}

let logEl, msgInput, sendBtn, connectBtn, statusEl, peerListEl

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
  statusEl.textContent = '🟢 Connected (Host)'
  statusEl.classList.add('connected')
}

async function initSignaling() {
  const channel = supabase.channel(`room:${roomId}:signaling`)
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const msg = payload
    if (msg.to === myUserId && msg.from !== myUserId) {
      log(`📡 ${msg.type}`)
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
  if (error) log(`Error: ${error.message}`)
}

async function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  })
  
  const dc = pc.createDataChannel('data', { ordered: true })
  setupDataChannel(dc, peerId)
  dataChannels.set(peerId, dc)
  
  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal(peerId, 'ice', event.candidate)
  }
  
  pc.ondatachannel = (event) => {
    setupDataChannel(event.channel, peerId)
    dataChannels.set(peerId, event.channel)
  }
  
  signalingCallbacks[peerId] = async (msg) => {
    try {
      if (msg.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data))
      } else if (msg.type === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(msg.data))
      }
    } catch (e) {
      console.error(e)
    }
  }
  
  peers.set(peerId, pc)
  return pc
}

function setupDataChannel(dc, peerId) {
  dc.onopen = () => {
    log(`✅ Channel open: ${peerId.substring(0, 8)}`)
    updatePeerList()
  }
  
  dc.onmessage = (event) => {
    log(`💬 ${peerId.substring(0, 8)}: ${event.data}`)
  }
  
  dc.onclose = () => {
    log(`❌ Channel closed`)
    updatePeerList()
  }
}

async function connectToPeer(peerId) {
  if (peers.has(peerId)) return
  log(`Connecting...`)
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
      li.textContent = `✅ ${peerId.substring(0, 8)}`
      peerListEl.appendChild(li)
    }
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
    
    if (Array.isArray(members)) {
      for (const m of members) {
        if (m.user_id !== myUserId) {
          await new Promise(r => setTimeout(r, 500))
          await connectToPeer(m.user_id)
        }
      }
    }
    
    log('✅ Ready!')
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
  peerListEl = document.getElementById('peerList')
  
  if (!logEl) {
    setTimeout(init, 100)
    return
  }
  
  connectBtn.onclick = start
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
      log(`You: ${msg}`)
      msgInput.value = ''
    } else {
      log('No peers connected')
    }
  }
}

document.addEventListener('DOMContentLoaded', init)

/** WebRTC Client - Browser Demo (Fixed) */

const SUPABASE_URL = 'https://enbyfbrgnyfbfbrqpxos.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q'

let sb = null
let myUserId = null
let roomId = '95552244-2f21-4f86-8cdc-417efc600b99'
let pc = null
let dataChannel = null
let signalingCallback = null
let pendingSignalMessages = [] // Buffer for messages before callback is set
let hostId = null
let logEl, msgInput, sendBtn, connectBtn, statusEl
let myIdEl, hostIdInput, useHostBtn, copyIdBtn

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
  sb = createClient(SUPABASE_URL, SUPABASE_KEY)
  
  const { error } = await sb.auth.signInAnonymously()
  if (error) throw error
  
  const { data } = await sb.auth.getUser()
  myUserId = data.user.id
  log(`✅ Auth: ${myUserId.substring(0, 8)}...`)

  if (myIdEl) myIdEl.textContent = myUserId
  if (copyIdBtn) copyIdBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(myUserId); log('Copied ID to clipboard') } catch (e) { log('Copy failed') }
  }
  
  const { error: joinError } = await sb
    .from('room_members')
    .insert({ room_id: roomId, user_id: myUserId })
  if (joinError && !joinError.message.includes('duplicate')) throw joinError
  
  log(`✅ Joined room`)
  statusEl.textContent = '🟡 Waiting for host...'
}

async function fetchMembers() {
  try {
    const { data: members } = await sb
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
    return members || []
  } catch (e) {
    console.error('[client] fetchMembers', e)
    return []
  }
}

async function initSignaling() {
  const channel = sb.channel(`room:${roomId}:signaling`)
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const msg = payload
    console.debug('[client] received raw signal payload', msg)
    console.log(`[client] Signal check - msg.to=${msg.to}, myUserId=${myUserId}, msg.from=${msg.from}, match=${msg.to === myUserId && msg.from !== myUserId}`)
    
    if (msg.to === myUserId && msg.from !== myUserId) {
      log(`📡 ${msg.type} from ${msg.from.substring(0,8)}`)
      if (signalingCallback) {
        console.log('[client] Calling signalingCallback immediately')
        signalingCallback(msg)
      } else {
        // Buffer message if callback not set yet
        console.debug('[client] buffering signal message, callback not ready')
        log(`⏳ Buffered ${msg.type} (callback not ready yet)`)
        pendingSignalMessages.push(msg)
      }
    } else {
      if (msg.to !== myUserId) {
        console.log(`[client] Ignoring message not for us: to=${msg.to}`)
      }
      if (msg.from === myUserId) {
        console.log('[client] Ignoring message from self')
      }
    }
  }).subscribe()
  log('🔊 Signaling ready')
}

async function sendSignal(to, type, data) {
  const msg = { from: myUserId, to, type, data }
  console.debug('[client] sendSignal', JSON.stringify(msg))
  log(`➡️ Sending ${type} to ${to.substring(0,8)}`)
  
  // Log what we're actually sending for debugging
  if (type === 'answer' || type === 'offer') {
    console.log(`[client] ${type} details:`, { type: data.type, sdpLength: data.sdp?.length })
  }
  
  const { error } = await sb.channel(`room:${roomId}:signaling`).send('broadcast', { event: 'signal', payload: msg })
  if (error) {
    log(`Error: ${error.message}`)
    console.error('[client] sendSignal error', error)
  }
}

async function createPeerConnection(hostIdParam) {
  hostId = hostIdParam
  log(`🛠 Creating RTCPeerConnection for host ${hostId.substring(0,8)}`)
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  })
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.debug('[client] ICE candidate', event.candidate)
      // Serialize ICE candidate properly
      const candidate = {
        candidate: event.candidate.candidate,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        sdpMid: event.candidate.sdpMid,
      }
      sendSignal(hostId, 'ice', candidate)
    }
  }
  
  pc.ondatachannel = (event) => {
    dataChannel = event.channel
    setupDataChannel()
  }
  
  signalingCallback = async (msg) => {
    try {
      if (msg.type === 'offer') {
        log(`📨 Received offer from ${msg.from.substring(0,8)}`)
        console.debug('[client] offer data:', msg.data)
        // Use RTCSessionDescription without new keyword in newer browsers
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data))
        log('📍 Remote description set')
        const answer = await pc.createAnswer()
        log('📋 Answer created')
        await pc.setLocalDescription(answer)
        log('📍 Local description set')
        // Serialize answer properly
        await sendSignal(hostId, 'answer', { type: answer.type, sdp: answer.sdp })
        log('📤 Answer sent')
      } else if (msg.type === 'ice') {
        console.debug('[client] ice candidate:', msg.data)
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.data))
          log('❄️ ICE candidate added')
        } catch (e) {
          console.debug('[client] ICE candidate error (may be normal):', e)
        }
      }
    } catch (e) {
      console.error('[client] Signaling callback error:', e)
      log(`Error processing signal: ${e.message}`)
    }
  }

  // Flush any pending messages that arrived before callback was set
  if (pendingSignalMessages.length > 0) {
    log(`Processing ${pendingSignalMessages.length} buffered signal(s)`)
    const messages = pendingSignalMessages.splice(0)
    for (const msg of messages) {
      try {
        await signalingCallback(msg)
      } catch (e) {
        console.error('[client] Error processing buffered message:', e)
      }
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
    
    const { data: members } = await sb
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .order('user_id', { ascending: true })
    
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error('No peers')
    }
    // allow user to specify host id via UI, otherwise pick first peer (sorted)
    const inputHost = hostIdInput && hostIdInput.value.trim()
    let potentialHost = inputHost || members[0].user_id
    if (potentialHost === myUserId) {
      log('No host found')
      return
    }

    // Notify host that we're ready so host will initiate the offer
    log(`Pinging host ${potentialHost.substring(0,8)} for connection...`)
    await sendSignal(potentialHost, 'ready', {})
    // prepare local peer connection so we can handle incoming offer
    await createPeerConnection(potentialHost)
    log(`Connecting to host ${potentialHost.substring(0,8)}...`)
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
  myIdEl = document.getElementById('myId')
  hostIdInput = document.getElementById('hostIdInput')
  useHostBtn = document.getElementById('useHostBtn')
  copyIdBtn = document.getElementById('copyId')
  
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

  if (useHostBtn) {
    useHostBtn.onclick = async () => {
      try {
        const text = await navigator.clipboard.readText()
        hostIdInput.value = text.trim()
        log('Pasted host ID from clipboard')
      } catch (e) {
        log('Clipboard paste failed')
      }
    }
  }

  if (copyIdBtn) {
    copyIdBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(myUserId); log('Copied ID to clipboard') } catch (e) { log('Copy failed') }
    }
  }
}

// Auto-start for debugging: use ?auto=1 in URL
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search)
  if (params.get('auto') === '1') {
    setTimeout(() => {
      if (connectBtn) connectBtn.click()
    }, 300)
  }
})

document.addEventListener('DOMContentLoaded', init)

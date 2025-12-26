/** WebRTC Host - Browser Demo (Fixed) */

const SUPABASE_URL = 'https://enbyfbrgnyfbfbrqpxos.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q'

let sb = null
let myUserId = null
let roomId = '95552244-2f21-4f86-8cdc-417efc600b99'
let peers = new Map()
let dataChannels = new Map()
let signalingCallbacks = {}
let pendingSignalMessages = {} // Buffer for messages before peer callbacks are set
let currentMembers = new Set()

let logEl, msgInput, sendBtn, connectBtn, statusEl, peerListEl
let myIdEl, membersListEl, copyIdBtn

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

  // update UI with our id if element exists
  if (myIdEl) myIdEl.textContent = myUserId
  if (copyIdBtn) copyIdBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(myUserId); log('Copied ID to clipboard') } catch (e) { log('Copy failed') }
  }
  
  const { error: joinError } = await sb
    .from('room_members')
    .insert({ room_id: roomId, user_id: myUserId })
  if (joinError && !joinError.message.includes('duplicate')) throw joinError
  
  log(`✅ Joined room`)
  statusEl.textContent = '🟢 Connected (Host)'
  statusEl.classList.add('connected')
}

async function initSignaling() {
  const channel = sb.channel(`room:${roomId}:signaling`)
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    const msg = payload
    console.debug('[host] received raw signal payload', msg)
    console.log(`[host] Signal check - msg.to=${msg.to}, myUserId=${myUserId}, msg.from=${msg.from}`)
    
    if (msg.to === myUserId && msg.from !== myUserId) {
      // If client announces readiness, only initiate connection if the id is known
      if (msg.type === 'ready') {
        log(`📡 ready from ${msg.from.substring(0,8)}`)
        console.log(`[host] Received ready, currentMembers has ${msg.from}? ${currentMembers.has(msg.from)}`)
        if (currentMembers.has(msg.from)) {
          connectToPeer(msg.from).catch(e=>{
            console.error('[host] connectToPeer error', e)
            log(`Error: ${e.message}`)
          })
        } else {
          // try refreshing members once, then check again
          console.debug('[host] ready from unknown member, refreshing members')
          log('🔄 Unknown member, refreshing list...')
          fetchAndRenderMembers().then(() => {
            if (currentMembers.has(msg.from)) {
              connectToPeer(msg.from).catch(e=>{
                console.error('[host] connectToPeer error', e)
                log(`Error: ${e.message}`)
              })
            } else {
              log(`Ignored ready from unknown user ${msg.from.substring(0,8)}`)
            }
          }).catch(e=>{
            console.error('[host] fetch members error', e)
            log(`Error fetching members: ${e.message}`)
          })
        }
        return
      }
      log(`📡 ${msg.type} from ${msg.from.substring(0,8)}`)
      console.log(`[host] Looking for callback for ${msg.from}`)
      if (signalingCallbacks[msg.from]) {
        console.log(`[host] Found callback for ${msg.from}`)
        signalingCallbacks[msg.from](msg)
      } else {
        // Buffer message if callback not set yet
        console.debug('[host] buffering signal message from', msg.from, 'type:', msg.type)
        log(`⏳ Buffered ${msg.type} from ${msg.from.substring(0,8)}`)
        if (!pendingSignalMessages[msg.from]) {
          pendingSignalMessages[msg.from] = []
        }
        pendingSignalMessages[msg.from].push(msg)
      }
    } else {
      if (msg.to !== myUserId) {
        console.log(`[host] Ignoring message not for us: to=${msg.to}`)
      }
      if (msg.from === myUserId) {
        console.log('[host] Ignoring message from self')
      }
    }
  }).subscribe()
  log('🔊 Signaling ready')
}

async function fetchAndRenderMembers() {
  try {
    const { data: members } = await sb
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
    const list = (members || []).filter(m => m && m.user_id)
    // update current members set
    currentMembers.clear()
    for (const m of list) currentMembers.add(m.user_id)
    renderMembers(list)
  } catch (e) {
    console.error('[host] fetch members error', e)
  }
}

function renderMembers(members) {
  if (!membersListEl) return
  membersListEl.innerHTML = ''
  const others = members.filter(m => m.user_id && m.user_id !== myUserId)
  if (others.length === 0) {
    membersListEl.innerHTML = '<li style="opacity:0.6">No other members</li>'
    return
  }
  for (const m of others) {
    const li = document.createElement('li')
    li.style.display = 'flex'
    li.style.justifyContent = 'space-between'
    li.style.alignItems = 'center'
    const span = document.createElement('span')
    span.textContent = m.user_id.substring(0,8)
    const btn = document.createElement('button')
    btn.textContent = 'Connect'
    // Only connect when user explicitly clicks — do not auto-connect
    btn.onclick = () => connectToPeer(m.user_id)
    li.appendChild(span)
    li.appendChild(btn)
    membersListEl.appendChild(li)
  }
}

async function sendSignal(to, type, data) {
  const msg = { from: myUserId, to, type, data }
  console.debug('[host] sendSignal', JSON.stringify(msg))
  log(`➡️ Sending ${type} to ${to.substring(0,8)}`)
  
  // Log what we're actually sending for debugging
  if (type === 'answer' || type === 'offer') {
    console.log(`[host] ${type} details:`, { type: data.type, sdpLength: data.sdp?.length })
  }
  
  const { error } = await sb.channel(`room:${roomId}:signaling`).send('broadcast', { event: 'signal', payload: msg })
  if (error) {
    log(`Error: ${error.message}`)
    console.error('[host] sendSignal error', error)
  }
}

async function createPeerConnection(peerId) {
  log(`🛠 Creating RTCPeerConnection for ${peerId.substring(0,8)}`)
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  })
  
  const dc = pc.createDataChannel('data', { ordered: true })
  log(`📨 Created datachannel for ${peerId.substring(0,8)}`)
  setupDataChannel(dc, peerId)
  dataChannels.set(peerId, dc)
  
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.debug('[host] ICE candidate for', peerId, event.candidate)
      // Serialize ICE candidate properly
      const candidate = {
        candidate: event.candidate.candidate,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        sdpMid: event.candidate.sdpMid,
      }
      sendSignal(peerId, 'ice', candidate)
    }
  }
  
  pc.ondatachannel = (event) => {
    setupDataChannel(event.channel, peerId)
    dataChannels.set(peerId, event.channel)
  }
  
  signalingCallbacks[peerId] = async (msg) => {
    try {
      if (msg.type === 'answer') {
        log(`📥 Answer received from ${peerId.substring(0,8)}`)
        console.debug('[host] answer data:', msg.data)
        await pc.setRemoteDescription(new RTCSessionDescription(msg.data))
        log('📍 Remote description set')
      } else if (msg.type === 'ice') {
        console.debug('[host] ice candidate:', msg.data)
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.data))
          log(`❄️ ICE from ${peerId.substring(0,8)}`)
        } catch (e) {
          console.debug('[host] ICE candidate error (may be normal):', e)
        }
      }
    } catch (e) {
      console.error('[host] Signaling callback error:', e)
      log(`Error: ${e.message}`)
    }
  }
  
  // Flush any pending messages that arrived before callback was set
  if (pendingSignalMessages[peerId] && pendingSignalMessages[peerId].length > 0) {
    log(`Processing ${pendingSignalMessages[peerId].length} buffered signal(s) from ${peerId.substring(0,8)}`)
    const messages = pendingSignalMessages[peerId].splice(0)
    for (const msg of messages) {
      try {
        await signalingCallbacks[peerId](msg)
      } catch (e) {
        console.error('[host] Error processing buffered message:', e)
      }
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
  if (peers.has(peerId)) {
    log(`Already connected to ${peerId.substring(0,8)}`)
    return
  }
  log(`Connecting to ${peerId.substring(0,8)}...`)
  const pc = await createPeerConnection(peerId)
  const offer = await pc.createOffer()
  log('📄 Offer created')
  await pc.setLocalDescription(offer)
  log('📍 Local description set')
  await sendSignal(peerId, 'offer', offer)
  log('📡 Offer sent')
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
    
    // fetch members and render list; user can click Connect per-member
    await fetchAndRenderMembers()
    
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
  myIdEl = document.getElementById('myId')
  membersListEl = document.getElementById('membersList')
  copyIdBtn = document.getElementById('copyId')
  const refreshMembersBtn = document.getElementById('refreshMembers')
  
  if (!logEl) {
    setTimeout(init, 100)
    return
  }
  
  connectBtn.onclick = start
  
  if (refreshMembersBtn) {
    refreshMembersBtn.onclick = async () => {
      refreshMembersBtn.disabled = true
      refreshMembersBtn.style.opacity = '0.6'
      try {
        await fetchAndRenderMembers()
        log('✅ Members list refreshed')
      } catch (e) {
        log(`Error refreshing members: ${e.message}`)
      } finally {
        refreshMembersBtn.disabled = false
        refreshMembersBtn.style.opacity = '1'
      }
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
      log(`You: ${msg}`)
      msgInput.value = ''
    } else {
      log('No peers connected')
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

/*
 WebRTC DataChannel implementation (Node) using Supabase signaling
 WITH Multi-Peer Support and Message Protocol v1

 Changes for Phase 5.4-5.5:
 1. Host maintains Map<peerId, RTCPeerConnection>
 2. Host auto-connects to new peers on join
 3. Host cleans up when peers leave
 4. Clients only accept offers from host
 5. Message protocol v1 with typed messages
*/

import { supabase } from './supabase'
import { ensureAuth } from './auth'
import { sendSignal, onSignal } from './signaling'
import { amIHost, listenForHostChanges } from './hostElection'
import { log } from './logger'

// Use dynamic import typing to avoid compile issues if wrtc is not present at type-check time
const wrtc = require('wrtc')
type RTCPeerConnectionT = any

function getIceServers() {
  const servers: any[] = []

  // Add TURN server from env if present
  const turnUrl = process.env.TURN_URL
  const turnUser = process.env.TURN_USER
  const turnPass = process.env.TURN_PASS

  if (turnUrl) {
    const turnEntry: any = { urls: turnUrl }
    if (turnUser && turnPass) {
      turnEntry.username = turnUser
      turnEntry.credential = turnPass
    }
    servers.push(turnEntry)
  }

  // Always include public STUN (most reliable)
  servers.push({ urls: 'stun:stun.l.google.com:19302' })
  servers.push({ urls: 'stun:stun1.l.google.com:19302' })

  // Optional: Add public TURN server (openrelay) if no custom TURN
  // Note: OpenRelay may have issues with wrtc on some systems; comment out if it causes PC creation to hang
  // if (!turnUrl) {
  //   servers.push({
  //     urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443']
  //   })
  // }

  return servers
}

// Message Protocol v1
export type RTCMessage = 
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'chat'; text: string }
  | { type: 'state'; payload: any }
  | { type: 'control'; action: string }

// Connection State Machine
type ConnectionState = 
  | 'idle'
  | 'offering'
  | 'answering'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed'

interface PeerConnection {
  pc: RTCPeerConnectionT
  dc: any | null
  state: ConnectionState
  retryCount: number
  lastError: string | null
}

let myUserId: string | null = null
let roomIdGlobal: string | null = null
let isHost = false
let currentHostId: string | null = null
let roomMembersChannel: any = null

const peerConnections: Map<string, PeerConnection> = new Map()
const pendingCandidates: Map<string, any[]> = new Map()

// Message handler type
type MessageHandler = (message: RTCMessage, peerId: string) => void
let messageHandler: MessageHandler = () => {}

/** Initialize WebRTC signaling and role detection. */
export async function initWebRTC(roomId: string) {
  if (!roomId) throw new Error('roomId required')
  roomIdGlobal = roomId

  myUserId = await ensureAuth()

  // Use proper host election
  isHost = await amIHost(roomId)
  console.log(`[webrtc] ${myUserId} is ${isHost ? 'HOST' : 'CLIENT'}`)

  // Get current host
  const { data: roomData } = await supabase
    .from('rooms')
    .select('host_id')
    .eq('id', roomId)
    .single()
  
  currentHostId = roomData?.host_id || null

  // Listen for host changes
  listenForHostChanges(roomId, (newHostId) => {
    const wasHost = isHost
    currentHostId = newHostId
    isHost = newHostId === myUserId
    
    if (!wasHost && isHost) {
      console.log('[webrtc] I became the host! Connecting to existing peers...')
      connectToExistingPeers()
    } else if (wasHost && !isHost) {
      console.log('[webrtc] I am no longer the host')
    }
  })

  // Set up room members subscription for multi-peer
  await setupRoomMembersSubscription(roomId)

  // listen for incoming signaling messages
  onSignal(async (msg: any) => {
    if (!myUserId) return
    if (msg.to !== myUserId) return
    if (msg.from === myUserId) return

    const from = msg.from as string
    
    // Phase 5.4: Clients only accept offers from host
    if (msg.type === 'offer' && !isHost && from !== currentHostId) {
      console.error(`[webrtc] Rejecting offer from non-host: ${from}`)
      return
    }

    try {
      if (msg.type === 'offer') {
        console.log('[webrtc] received offer from', from)
        await handleOffer(from, msg.data)
      } else if (msg.type === 'answer') {
        console.log('[webrtc] received answer from', from)
        await handleAnswer(from, msg.data)
      } else if (msg.type === 'ice') {
        await handleRemoteIce(from, msg.data)
      }
    } catch (e) {
      console.error('[webrtc] error handling signal', e)
    }
  })
}

/** Set up subscription to room members for auto-connection/disconnection */
async function setupRoomMembersSubscription(roomId: string) {
  roomMembersChannel = supabase.channel(`room-members:${roomId}`)
  
  roomMembersChannel.on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'room_members',
      filter: `room_id=eq.${roomId}`
    },
    (payload: any) => {
      const newUserId = payload.new.user_id
      log.debug('webrtc', `INSERT event: new member ${newUserId.substring(0, 8)}`)
      if (newUserId !== myUserId && isHost) {
        log.info('webrtc', `New member joined: ${newUserId.substring(0, 8)}, auto-connecting...`)
        connectToPeer(newUserId).catch(e => 
          log.error('webrtc', `Failed to auto-connect to ${newUserId.substring(0, 8)}:`, e.message)
        )
      }
    }
  )

  roomMembersChannel.on(
    'postgres_changes',
    {
      event: 'DELETE',
      schema: 'public',
      table: 'room_members',
      filter: `room_id=eq.${roomId}`
    },
    (payload: any) => {
      const leftUserId = payload.old.user_id
      log.debug('webrtc', `DELETE event: member left ${leftUserId.substring(0, 8)}`)
      if (leftUserId !== myUserId) {
        log.info('webrtc', `Member left: ${leftUserId.substring(0, 8)}, cleaning up...`)
        closePeer(leftUserId).catch(e =>
          log.error('webrtc', `Failed to clean up ${leftUserId.substring(0, 8)}:`, e.message)
        )
      }
    }
  )

  await new Promise<void>((resolve, reject) => {
    roomMembersChannel.subscribe((status: any, err?: Error) => {
      if (err) reject(err)
      else if (status === 'SUBSCRIBED') resolve()
    })
  })
  
  log.info('webrtc', `Subscribed to room members for ${roomId}`)
}

/** Connect to all existing peers (host only) */
async function connectToExistingPeers() {
  if (!roomIdGlobal || !isHost) return

  const { data: members } = await supabase
    .from('room_members')
    .select('user_id')
    .eq('room_id', roomIdGlobal)
    .neq('user_id', myUserId)

  console.log(`[webrtc] Connecting to ${members?.length || 0} existing peers`)
  
  for (const member of members || []) {
    await connectToPeer(member.user_id)
  }
}

/** Host: create a peer connection and send an offer to peerId. */
export async function connectToPeer(peerId: string) {
  if (!myUserId) throw new Error('not initialized')
  if (!isHost) {
    throw new Error('Permission denied: only host can connect to peers')
  }
  
  // Check if we already have a connection
  const existing = peerConnections.get(peerId)
  if (existing && (existing.state === 'connected' || existing.state === 'connecting')) {
    console.log(`[webrtc] Already ${existing.state} with ${peerId}`)
    return
  }

  try {
    updatePeerState(peerId, 'offering')
    
    const pc = createPeerConnection(peerId, true)
    
    // Validate PC state before creating data channel
    if (pc.signalingState === 'closed') {
      const err = `PC created with signalingState='closed' for ${peerId}`
      log.error('webrtc', err)
      updatePeerState(peerId, 'failed', err)
      throw new Error(err)
    }

    log.debug('webrtc', `Creating data channel for ${peerId.substring(0,8)}, signalingState=${pc.signalingState}`)
    const dc = pc.createDataChannel('data')
    
    peerConnections.set(peerId, {
      pc,
      dc,
      state: 'offering',
      retryCount: 0,
      lastError: null
    })

    setupDataChannel(peerId, dc)

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      updatePeerState(peerId, 'connecting')

      try {
        log.info('webrtc', `offer created for ${peerId.substring(0,8)} type=${offer.type} size=${offer.sdp?.length || 0}`)
      } catch {}

      await sendSignal(peerId, 'offer', { type: offer.type, sdp: offer.sdp })
      log.debug('webrtc', `sent offer to ${peerId.substring(0,8)}`)
    } catch (e: any) {
      updatePeerState(peerId, 'failed', `Failed to create offer: ${e.message}`)
      throw e
    }
  } catch (e: any) {
    log.error('webrtc', `connectToPeer(${peerId.substring(0,8)}) failed:`, e.message)
    throw e
  }
}

/** Send a typed message to peer */
export function sendToPeer(peerId: string, message: RTCMessage) {
  const conn = peerConnections.get(peerId)
  if (!conn) {
    const err = `No connection for peer ${peerId}`
    log.error('webrtc', err)
    throw new Error(err)
  }
  if (!conn.dc) {
    const err = `No datachannel for peer ${peerId}`
    log.error('webrtc', err)
    throw new Error(err)
  }
  if (conn.dc.readyState !== 'open') {
    const err = `DataChannel not open for ${peerId} (state: ${conn.dc.readyState})`
    log.error('webrtc', err)
    throw new Error(err)
  }
  if (conn.state !== 'connected') {
    const err = `Peer not in connected state (state: ${conn.state})`
    log.error('webrtc', err)
    throw new Error(err)
  }
  
  try {
    conn.dc.send(JSON.stringify(message))
    log.debug('webrtc', `sent to ${peerId}:`, message)
  } catch (e) {
    log.error('webrtc', `sendToPeer failed for ${peerId}:`, e)
    throw e
  }
}

/** Broadcast a typed message to all connected peers */
export function broadcast(message: RTCMessage) {
  let sent = 0
  const errors: string[] = []
  
  for (const [peerId, conn] of peerConnections.entries()) {
    if (conn.dc && conn.dc.readyState === 'open' && conn.state === 'connected') {
      try {
        conn.dc.send(JSON.stringify(message))
        sent++
      } catch (e) {
        errors.push(`${peerId}: ${e}`)
      }
    }
  }
  
  if (sent === 0) {
    log.warn('webrtc', `broadcast to 0 peers (${peerConnections.size} total connections)`)
  } else {
    log.info('webrtc', `broadcast to ${sent} peer(s)`)
  }
  
  if (errors.length > 0) {
    log.error('webrtc', `broadcast errors: ${errors.join('; ')}`)
  }
}

/** Set message handler for incoming messages */
export function onMessage(handler: MessageHandler) {
  messageHandler = handler
}

/** Close peer connection and cleanup */
export async function closePeer(peerId: string) {
  const conn = peerConnections.get(peerId)
  if (conn) {
    try {
      conn.pc.close()
    } catch {}
    updatePeerState(peerId, 'closed')
  }
  peerConnections.delete(peerId)
  pendingCandidates.delete(peerId)
}

/** Internal: create RTCPeerConnection with handlers */
function createPeerConnection(peerId: string, isInitiator: boolean): RTCPeerConnectionT {
  log.debug('webrtc', `createPeerConnection for ${peerId.substring(0,8)}, isInitiator=${isInitiator}`)
  const pc = new wrtc.RTCPeerConnection({ iceServers: getIceServers() })
  
  log.debug('webrtc', `PC created for ${peerId.substring(0,8)}, signalingState=${pc.signalingState}, connectionState=${pc.connectionState}`)

  pc.onicecandidate = (ev: any) => {
    const c = ev.candidate
    if (c) {
      try {
        // Log candidate detail for troubleshooting
        log.debug('webrtc', `onicecandidate → ${peerId.substring(0,8)}:`, c.candidate ? c.candidate : c)
      } catch {}

      sendSignal(peerId, 'ice', c).catch(e => log.error('webrtc', '[webrtc] send ice failed', e.message))
    }
  }

  pc.onicegatheringstatechange = () => {
    try { log.debug('webrtc', `iceGatheringState ${peerId.substring(0,8)}: ${pc.iceGatheringState}`) } catch {}
  }

  pc.onsignalingstatechange = () => {
    try { log.debug('webrtc', `signalingState ${peerId.substring(0,8)}: ${pc.signalingState}`) } catch {}
  }

  pc.onconnectionstatechange = () => {
    try { log.debug('webrtc', `connectionState ${peerId.substring(0,8)}: ${pc.connectionState}`) } catch {}
  }

  pc.oniceconnectionstatechange = () => {
    const conn = peerConnections.get(peerId)
    if (!conn) return
    
    const state = pc.iceConnectionState
    console.log(`[webrtc] ICE connection state for ${peerId}: ${state}`)
    
    if (state === 'failed' || state === 'disconnected') {
      if (conn.retryCount < 1) {
        console.log(`[webrtc] Attempting retry for ${peerId}`)
        conn.retryCount++
        // Trigger reconnection for host
        if (isHost) {
          setTimeout(() => {
            if (peerConnections.has(peerId)) {
              connectToPeer(peerId).catch(e => 
                console.error(`[webrtc] Retry failed for ${peerId}:`, e)
              )
            }
          }, 1000)
        }
      } else {
        updatePeerState(peerId, 'failed', `ICE connection ${state}`)
      }
    } else if (state === 'connected' || state === 'completed') {
      updatePeerState(peerId, 'connected')
    }
  }

  // Client receives datachannel via ondatachannel
  pc.ondatachannel = (ev: any) => {
    const dc = ev.channel
    const conn = peerConnections.get(peerId)
    if (conn) {
      setupDataChannel(peerId, dc)
      conn.dc = dc
    } else {
      const newConn: PeerConnection = {
        pc,
        dc,
        state: 'connecting',
        retryCount: 0,
        lastError: null
      }
      peerConnections.set(peerId, newConn)
      setupDataChannel(peerId, dc)
    }
  }

  pendingCandidates.set(peerId, [])
  return pc
}

function setupDataChannel(peerId: string, dc: any) {
  dc.onopen = () => {
    console.log(`✅ DataChannel open with ${peerId}`)
    updatePeerState(peerId, 'connected')
  }
  
  dc.onmessage = (ev: any) => {
    try {
      const message = JSON.parse(ev.data) as RTCMessage
      console.log(`[webrtc] message from ${peerId}:`, message)
      
      // Auto-reply for ping
      if (message.type === 'ping') {
        sendToPeer(peerId, { type: 'pong' })
      }
      
      // Call message handler
      messageHandler(message, peerId)
    } catch (e) {
      console.error(`[webrtc] Failed to parse message from ${peerId}:`, e)
    }
  }
  
  dc.onclose = () => {
    console.log(`[webrtc] datachannel closed for ${peerId}`)
    updatePeerState(peerId, 'closed')
  }
  
  dc.onerror = (ev: any) => {
    console.error(`[webrtc] datachannel error for ${peerId}:`, ev)
    updatePeerState(peerId, 'failed', 'DataChannel error')
  }
}

/** Handle incoming offer (client path) */
async function handleOffer(from: string, offer: any) {
  const existing = peerConnections.get(from)
  if (existing && (existing.state === 'connected' || existing.state === 'connecting')) {
    console.warn(`[webrtc] Already ${existing.state} with ${from}, ignoring duplicate offer`)
    return
  }

  updatePeerState(from, 'answering')
  
  const pc = createPeerConnection(from, false)
  const conn: PeerConnection = {
    pc,
    dc: null,
    state: 'answering',
    retryCount: 0,
    lastError: null
  }
  peerConnections.set(from, conn)

  try {
    console.log(`[webrtc] Setting remote description from ${from}`)
    await pc.setRemoteDescription(new wrtc.RTCSessionDescription(offer))
    console.log(`[webrtc] Remote description set, creating answer`)
    
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    updatePeerState(from, 'connecting')

    try {
      log.info('webrtc', `answer created for ${from.substring(0,8)} type=${answer.type} size=${answer.sdp?.length || 0}`)
    } catch {}

    await sendSignal(from, 'answer', { type: answer.type, sdp: answer.sdp })
    log.debug('webrtc', `sent answer to ${from.substring(0,8)}`)

    // Flush pending ICE candidates immediately
    const pend = pendingCandidates.get(from) || []
    log.debug('webrtc', `Flushing ${pend.length} pending ICE candidates for ${from.substring(0,8)}`)
    for (const cand of pend) {
      try {
        const iceCandidate = new wrtc.RTCIceCandidate({
          candidate: cand.candidate,
          sdpMLineIndex: cand.sdpMLineIndex,
          sdpMid: cand.sdpMid,
        })
        await pc.addIceCandidate(iceCandidate)
      } catch (e: any) {
        log.debug('webrtc', `addIceCandidate error for ${from.substring(0,8)}:`, e.message)
      }
    }
    pendingCandidates.set(from, [])
  } catch (e: any) {
    updatePeerState(from, 'failed', `Failed to handle offer: ${e.message}`)
    throw e
  }
}

/** Handle incoming answer (host path) */
async function handleAnswer(from: string, answer: any) {
  const conn = peerConnections.get(from)
  if (!conn) {
    console.warn('[webrtc] no pc for answer from', from)
    return
  }

  try {
    await conn.pc.setRemoteDescription(new wrtc.RTCSessionDescription(answer))
    log.debug('webrtc', `setRemoteDescription(answer) for ${from.substring(0,8)} signaling=${conn.pc.signalingState}`)
    updatePeerState(from, 'connecting')

    // Flush pending candidates immediately
    const pend = pendingCandidates.get(from) || []
    log.debug('webrtc', `Flushing ${pend.length} candidates for ${from.substring(0,8)}`)
    for (const cand of pend) {
      try {
        await conn.pc.addIceCandidate(new wrtc.RTCIceCandidate(cand))
      } catch (e: any) {
        log.debug('webrtc', `addIceCandidate error for ${from.substring(0,8)}:`, e.message)
      }
    }
    pendingCandidates.set(from, [])
  } catch (e: any) {
    updatePeerState(from, 'failed', `Failed to handle answer: ${e.message}`)
    throw e
  }
}

/** Handle incoming remote ICE candidate */
async function handleRemoteIce(from: string, cand: any) {
  const conn = peerConnections.get(from)
  if (!conn) {
    console.log(`[webrtc] No PC yet for ${from}, queuing ICE candidate`)
    const arr = pendingCandidates.get(from) || []
    arr.push(cand)
    pendingCandidates.set(from, arr)
    return
  }
  try {
    // Create RTCIceCandidate with proper fields
    const iceCandidate = new wrtc.RTCIceCandidate({
      candidate: cand.candidate,
      sdpMLineIndex: cand.sdpMLineIndex,
      sdpMid: cand.sdpMid,
    })
    await conn.pc.addIceCandidate(iceCandidate)
    console.log(`[webrtc] Added ICE candidate from ${from}`)
  } catch (e: any) {
    console.warn(`[webrtc] addIceCandidate failed for ${from}:`, e.message)
  }
}

/** Update peer state with validation */
function updatePeerState(peerId: string, newState: ConnectionState, error?: string) {
  const conn = peerConnections.get(peerId)
  const oldState = conn?.state || 'idle'
  
  // State transition validation
  const validTransitions: Record<ConnectionState, ConnectionState[]> = {
    idle: ['offering', 'answering', 'closed'],
    offering: ['connecting', 'failed', 'closed'],
    answering: ['connecting', 'failed', 'closed'],
    connecting: ['connected', 'failed', 'closed'],
    connected: ['failed', 'closed'],
    failed: ['connecting', 'closed'],
    closed: []
  }

  if (!validTransitions[oldState]?.includes(newState)) {
    console.warn(`[webrtc] Invalid state transition: ${oldState} -> ${newState} for ${peerId}`)
  }

  if (conn) {
    conn.state = newState
    if (error) {
      conn.lastError = error
      console.error(`[webrtc] ${peerId} state: ${oldState} -> ${newState}, error: ${error}`)
    } else {
      console.log(`[webrtc] ${peerId} state: ${oldState} -> ${newState}`)
    }
    
    if (newState === 'connected') {
      conn.retryCount = 0
    }
  } else if (newState !== 'closed') {
    peerConnections.set(peerId, {
      pc: null as any,
      dc: null,
      state: newState,
      retryCount: 0,
      lastError: error || null
    })
  }
}

/** Get current state of peer connection */
export function getPeerState(peerId: string): ConnectionState | null {
  return peerConnections.get(peerId)?.state || null
}

/** Get all connected peers */
export function getConnectedPeers(): string[] {
  const peers: string[] = []
  for (const [peerId, conn] of peerConnections.entries()) {
    if (conn.state === 'connected') {
      peers.push(peerId)
    }
  }
  return peers
}

/** Cleanup all connections */
export async function cleanup() {
  for (const peerId of Array.from(peerConnections.keys())) {
    await closePeer(peerId)
  }
  
  if (roomMembersChannel) {
    try {
      await roomMembersChannel.unsubscribe()
    } catch (e) {
      console.error('[webrtc] Error unsubscribing room members channel:', e)
    }
    roomMembersChannel = null
  }
  
  console.log('[webrtc] Cleanup complete')
}

export default {
  initWebRTC,
  connectToPeer,
  sendToPeer,
  broadcast,
  onMessage,
  closePeer,
  getPeerState,
  getConnectedPeers,
  cleanup
}
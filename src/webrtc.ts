/*
 WebRTC DataChannel implementation (Node) using Supabase signaling

 - Host-driven flow: first user in room is host (determined by room_members count === 1)
 - Host creates RTCPeerConnection and DataChannel for each peer and sends offers
 - Client never creates offers; client responds with answers when it receives an offer
 - Signaling via existing `sendSignal()` and `onSignal()` (signal messages: offer/answer/ice)
 - DataChannel name: "data" (reliable)

 Public API:
 - initWebRTC(roomId)
 - connectToPeer(peerId)            // host only: create offer for peer
 - sendToPeer(peerId, message)
 - broadcast(message)
 - closePeer(peerId)

 Notes:
 - Requires `wrtc` package when running in Node (ts-node). Install with `npm i wrtc`.
 - Uses Google STUN: stun:stun.l.google.com:19302
*/

import { supabase } from './supabase'
import { ensureAuth } from './auth'
import { sendSignal, onSignal } from './signaling'

// Use dynamic import typing to avoid compile issues if wrtc is not present at type-check time
const wrtc = require('wrtc')
type RTCPeerConnectionT = any

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

let myUserId: string | null = null
let roomIdGlobal: string | null = null
let isHost = false

const pcs: Map<string, RTCPeerConnectionT> = new Map()
const dataChannels: Map<string, any> = new Map()
const pendingCandidates: Map<string, any[]> = new Map()

/** Initialize WebRTC signaling and role detection. */
export async function initWebRTC(roomId: string) {
  if (!roomId) throw new Error('roomId required')
  roomIdGlobal = roomId

  myUserId = await ensureAuth()

  // determine host: check FORCE_HOST env var first, otherwise first user alphabetically
  if (process.env.FORCE_HOST === 'true') {
    isHost = true
  } else {
    const { data: members, error } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .order('user_id', { ascending: true })

    if (error) {
      console.warn('Could not read room_members to determine host:', error)
      // default to client role
      isHost = false
    } else {
      if (Array.isArray(members) && members.length > 0 && members[0].user_id === myUserId) {
        isHost = true
      } else {
        isHost = false
      }
    }
  }

  console.log(`[webrtc] initWebRTC room=${roomId} user=${myUserId} isHost=${isHost}`)

  // listen for incoming signaling messages
  onSignal(async (msg: any) => {
    // signaling module already filters by `to === myUserId` and skips self messages,
    // but sanity-check here as well
    if (!myUserId) return
    if (msg.to !== myUserId) return
    if (msg.from === myUserId) return

    const from = msg.from as string
    try {
      if (msg.type === 'offer') {
        // Client path: create PC, set remote offer, create answer
        console.log('[webrtc] received offer from', from)
        await handleOffer(from, msg.data)
      } else if (msg.type === 'answer') {
        console.log('[webrtc] received answer from', from)
        await handleAnswer(from, msg.data)
      } else if (msg.type === 'ice') {
        // incoming ICE candidate
        await handleRemoteIce(from, msg.data)
      } else {
        console.warn('[webrtc] unknown signal type', msg.type)
      }
    } catch (e) {
      console.error('[webrtc] error handling signal', e)
    }
  })
}

/** Host: create a peer connection and send an offer to peerId. */
export async function connectToPeer(peerId: string) {
  if (!myUserId) throw new Error('not initialized')
  if (!isHost) throw new Error('connectToPeer only allowed for host')
  if (pcs.has(peerId)) return

  const pc = createPeerConnection(peerId, true)
  pcs.set(peerId, pc)

  // create reliable data channel named 'data'
  const dc = pc.createDataChannel('data')
  setupDataChannel(peerId, dc)
  dataChannels.set(peerId, dc)

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  // send plain offer
  await sendSignal(peerId, 'offer', { type: offer.type, sdp: offer.sdp })
  console.log('[webrtc] sent offer to', peerId)
}

/** Send a string message to peer via DataChannel. */
export function sendToPeer(peerId: string, message: string) {
  const dc = dataChannels.get(peerId)
  if (!dc) throw new Error('no data channel for peer')
  if (dc.readyState !== 'open') throw new Error('datachannel not open')
  dc.send(message)
}

/** Broadcast a string message to all connected peers. */
export function broadcast(message: string) {
  for (const [peerId, dc] of dataChannels.entries()) {
    if (dc && dc.readyState === 'open') {
      dc.send(message)
    }
  }
}

/** Close peer connection and cleanup. */
export async function closePeer(peerId: string) {
  const pc = pcs.get(peerId)
  if (pc) {
    try {
      pc.close()
    } catch {}
    pcs.delete(peerId)
  }
  if (dataChannels.has(peerId)) dataChannels.delete(peerId)
  pendingCandidates.delete(peerId)
}

/** Internal: create RTCPeerConnection with handlers. */
function createPeerConnection(peerId: string, isInitiator: boolean) {
  const pc = new wrtc.RTCPeerConnection({ iceServers: ICE_SERVERS })

  // send local ICE candidates to peer via signaling
  pc.onicecandidate = (ev: any) => {
    const c = ev.candidate
    if (c) {
      // send candidate object
      sendSignal(peerId, 'ice', c).catch(e => console.error('[webrtc] send ice failed', e))
    }
  }

  pc.onconnectionstatechange = () => {
    console.log('[webrtc] connectionState', peerId, pc.connectionState)
  }

  // client receives datachannel via ondatachannel
  pc.ondatachannel = (ev: any) => {
    const dc = ev.channel
    setupDataChannel(peerId, dc)
    dataChannels.set(peerId, dc)
  }

  // prepare pending candidates list
  pendingCandidates.set(peerId, [])

  return pc
}

function setupDataChannel(peerId: string, dc: any) {
  dc.onopen = () => {
    console.log(`✅ DataChannel open with ${peerId}`)
  }
  dc.onmessage = (ev: any) => {
    console.log(`[webrtc] message from ${peerId}:`, ev.data)
    // auto-reply example: if receives 'ping' reply 'pong'
    try {
      const text = typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data)
      if (text === 'ping') {
        dc.send('pong')
      }
    } catch (e) {
      console.error('datachannel message handler error', e)
    }
  }
  dc.onclose = () => {
    console.log('[webrtc] datachannel closed for', peerId)
  }
}

/** Handle incoming offer (client path). */
async function handleOffer(from: string, offer: any) {
  // create pc if not exists
  if (pcs.has(from)) {
    console.warn('[webrtc] already have pc for', from)
  }
  const pc = createPeerConnection(from, false)
  pcs.set(from, pc)

  // set remote description
  await pc.setRemoteDescription(new wrtc.RTCSessionDescription(offer))

  // create answer
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)

  // send answer back to host
  await sendSignal(from, 'answer', { type: answer.type, sdp: answer.sdp })
  console.log('[webrtc] sent answer to', from)

  // flush pending ICE candidates if any
  const pend = pendingCandidates.get(from) || []
  for (const cand of pend) {
    try {
      await pc.addIceCandidate(new wrtc.RTCIceCandidate(cand))
    } catch (e) {
      console.warn('[webrtc] addIceCandidate error (pending flush)', e)
    }
  }
  pendingCandidates.set(from, [])
}

/** Handle incoming answer (host path). */
async function handleAnswer(from: string, answer: any) {
  const pc = pcs.get(from)
  if (!pc) {
    console.warn('[webrtc] no pc for answer from', from)
    return
  }
  await pc.setRemoteDescription(new wrtc.RTCSessionDescription(answer))

  // flush pending ICE candidates
  const pend = pendingCandidates.get(from) || []
  for (const cand of pend) {
    try {
      await pc.addIceCandidate(new wrtc.RTCIceCandidate(cand))
    } catch (e) {
      console.warn('[webrtc] addIceCandidate error (pending flush)', e)
    }
  }
  pendingCandidates.set(from, [])
}

/** Handle incoming remote ICE candidate. */
async function handleRemoteIce(from: string, cand: any) {
  const pc = pcs.get(from)
  if (!pc) {
    // store candidate to add later when pc/remoteDesc available
    const arr = pendingCandidates.get(from) || []
    arr.push(cand)
    pendingCandidates.set(from, arr)
    return
  }
  try {
    await pc.addIceCandidate(new wrtc.RTCIceCandidate(cand))
  } catch (e) {
    console.warn('[webrtc] addIceCandidate failed', e)
  }
}

export default {
  initWebRTC,
  connectToPeer,
  sendToPeer,
  broadcast,
  closePeer
}

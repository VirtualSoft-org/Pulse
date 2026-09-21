import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let presenceCh = null
let bcastCh = null
let me = null
let myName = 'guest'
let myReady = false
let topic = null
let live = false
let retries = 0
let handlers = {}
let myJoinedAt = 0

function topicFor(roomId, passphrase) {
  const raw = `${roomId}::${passphrase || ''}`
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x85ebca6b)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

function computeHost(members) {
  if (!members.length) return null
  const sorted = [...members].sort((a, b) =>
    (a.joinedAt || 0) - (b.joinedAt || 0) ||
    String(a.user_id || '').localeCompare(String(b.user_id || ''))
  )
  return sorted[0].user_id || null
}

function emitMembers() {
  if (!presenceCh) return
  const state = presenceCh.presenceState() || {}
  const members = []
  for (const [key, payloads] of Object.entries(state)) {
    for (const p of payloads) {
      members.push({
        name: p.name || '?',
        ready: !!p.ready,
        user_id: p.user_id || key,
        joinedAt: p.joinedAt || 0,
      })
    }
  }
  console.log('[pulse] presence members:', members)
  handlers.onMembers?.(members)
  handlers.onHost?.(computeHost(members))
}

export async function connect(roomId, displayName, passphrase, h = {}) {
  handlers = h
  await disconnect()

  let { data: { session } } = await sb.auth.getSession()
  if (!session) {
    const { data, error } = await sb.auth.signInAnonymously()
    if (error) throw error
    session = data.session
  }
  me = session.user.id
  myName = displayName || 'guest'
  myReady = false
  myJoinedAt = Date.now()
  topic = topicFor(roomId, passphrase)
  retries = 0
  live = false
  await open()
  return me
}

function open() {
  presenceCh = sb.channel(`pulse:p:${topic}`, { config: { presence: { key: me } } })
  bcastCh = sb.channel(`pulse:b:${topic}`, { config: { broadcast: { self: false } } })

  presenceCh.on('presence', { event: 'sync' }, () => {
    emitMembers()
  })

  bcastCh.on('broadcast', { event: 'e' }, ({ payload }) => {
    if (!payload || payload.from === me) return
    if (payload.to && payload.to !== me) return
    handlers.onEvent?.(payload)
  })

  const subscribeOne = (ch, label) => new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(label + ' timeout')) } }, 8000)
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        if (!settled) { settled = true; resolve() }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timer)
        if (!settled) { settled = true; reject(err || new Error(status)) }
        else if (live) scheduleReconnect()
      }
    })
  })

  return Promise.all([subscribeOne(presenceCh, 'presence'), subscribeOne(bcastCh, 'broadcast')])
    .then(async () => {
      live = true
      retries = 0
      handlers.onStatus?.('connected')
      await presenceCh.track({ name: myName, user_id: me, ready: myReady, joinedAt: myJoinedAt })
      startPresencePoll()
    })
}

async function removeStale() {
  if (presenceCh) { try { await sb.removeChannel(presenceCh) } catch {} }
  if (bcastCh) { try { await sb.removeChannel(bcastCh) } catch {} }
  presenceCh = null
  bcastCh = null
}

function scheduleReconnect() {
  if (!live) return
  live = false
  retries++
  handlers.onStatus?.(retries >= 5 ? 'lost' : 'reconnecting')
  const wait = Math.min(10000, 500 * 2 ** retries)
  setTimeout(async () => {
    if (!topic) return
    await removeStale()
    try { await open() } catch { scheduleReconnect() }
  }, wait)
}

function send(e) {
  if (!bcastCh || !live) return Promise.resolve()
  return bcastCh.send({ type: 'broadcast', event: 'e', payload: { ...e, from: me, name: myName } })
}

export const sendPlay    = at            => send({ t: 'play', at, sentAt: Date.now() })
export const sendPause   = at            => send({ t: 'pause', at })
export const sendChat    = text          => send({ t: 'chat', text })
export const sendSyncReq = (hash, at)    => send({ t: 'sync_req', hash, at })
export const sendSyncRes = (to, ok, off) => send({ t: 'sync_res', to, ok, offset: off })
export const sendReaction = emoji        => send({ t: 'reaction', emoji })
export const sendPosReq  = ()            => send({ t: 'pos_req' })
export const sendPosRes  = (to, at, playing) => send({ t: 'pos_res', to, at, playing, sentAt: Date.now() })

export async function setReady(ready) {
  myReady = ready
  if (presenceCh && live) { try { await presenceCh.track({ name: myName, user_id: me, ready: myReady, joinedAt: myJoinedAt }) } catch {} }
}

export function myId() { return me }

export async function disconnect() {
  topic = null
  live = false
  stopPresencePoll()
  if (presenceCh) { try { await presenceCh.untrack() } catch {} }
  await removeStale()
}

let pollTimer = null
function startPresencePoll() {
  stopPresencePoll()
  let last = ''
  pollTimer = setInterval(() => {
    if (!presenceCh) return
    const state = presenceCh.presenceState() || {}
    const key = JSON.stringify(state)
    if (key !== last) { last = key; emitMembers() }
  }, 1200)
}
function stopPresencePoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

window.pulseDebug = {
  state: () => ({ presence: presenceCh?.state, broadcast: bcastCh?.state, live, topic }),
  members: () => presenceCh?.presenceState(),
}
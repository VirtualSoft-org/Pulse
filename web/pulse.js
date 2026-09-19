import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let presenceCh = null
let bcastCh = null
let me = null
let myName = 'guest'
let topic = null
let live = false
let retries = 0
let handlers = {}

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

export async function connect(roomId, displayName, passphrase, h = {}) {
  handlers = h
  await disconnect()   // always start clean, no leftover channels

  let { data: { session } } = await sb.auth.getSession()
  if (!session) {
    const { data, error } = await sb.auth.signInAnonymously()
    if (error) throw error
    session = data.session
  }
  me = session.user.id
  myName = displayName || 'guest'
  topic = topicFor(roomId, passphrase)
  retries = 0
  live = false
  console.log('[pulse] connecting as', myName, me, 'topic', topic)
  await open()
  return me
}

function open() {
  presenceCh = sb.channel(`pulse:p:${topic}`, { config: { presence: { key: me } } })
  bcastCh = sb.channel(`pulse:b:${topic}`, { config: { broadcast: { self: false } } })

  presenceCh.on('presence', { event: 'sync' }, () => {
    const state = presenceCh.presenceState() || {}
    console.log('[pulse] presence sync:', state)
    handlers.onMembers?.(Object.values(state).flat().map(m => m.name || '?'))
  })

  bcastCh.on('broadcast', { event: 'e' }, ({ payload }) => {
    console.log('[pulse] broadcast received:', payload)
    if (!payload || payload.from === me) return
    if (payload.to && payload.to !== me) return
    handlers.onEvent?.(payload)
  })

  const subscribeOne = (ch, label) => new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(label + ' timeout')) } }, 8000)
    ch.subscribe((status, err) => {
      console.log(`[pulse] ${label} status:`, status, err || '')
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
      const res = await presenceCh.track({ name: myName, user_id: me })
      console.log('[pulse] track result:', res)
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
  handlers.onStatus?.('reconnecting')
  retries++
  console.warn('[pulse] scheduling reconnect, attempt', retries)
  const wait = Math.min(10000, 500 * 2 ** retries)
  setTimeout(async () => {
    if (!topic) return
    await removeStale()
    try { await open() } catch (e) { console.error('[pulse] reconnect failed:', e); scheduleReconnect() }
  }, wait)
}

function send(e) {
  if (!bcastCh || !live) { console.warn('[pulse] send skipped, not live'); return Promise.resolve() }
  return bcastCh.send({ type: 'broadcast', event: 'e', payload: { ...e, from: me, name: myName } })
    .then(r => console.log('[pulse] send result:', r))
}

export const sendPlay    = at            => send({ t: 'play', at, sentAt: Date.now() })
export const sendPause   = at            => send({ t: 'pause', at })
export const sendChat    = text          => send({ t: 'chat', text })
export const sendSyncReq = (hash, at)    => send({ t: 'sync_req', hash, at })
export const sendSyncRes = (to, ok, off) => send({ t: 'sync_res', to, ok, offset: off })

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
    const names = Object.values(state).flat().map(m => m.name || '?')
    const key = names.slice().sort().join(',')
    if (key !== last) {
      last = key
      console.log('[pulse] presence poll:', names)
      handlers.onMembers?.(names)
    }
  }, 1200)
}
function stopPresencePoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

// debug helper — open console and type: pulseDebug.state()
window.pulseDebug = {
  state: () => ({ presence: presenceCh?.state, broadcast: bcastCh?.state, live, topic }),
  members: () => presenceCh?.presenceState(),
}
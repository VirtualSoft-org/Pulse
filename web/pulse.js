import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let presenceCh = null   // handles member list only
let bcastCh = null      // handles play/pause/chat/sync only — kept separate, see note below
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
  if (presenceCh || bcastCh) await disconnect()

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
  await open()
  return me
}

function open() {
  presenceCh = sb.channel(`pulse:p:${topic}`, { config: { presence: { key: me } } })
  bcastCh = sb.channel(`pulse:b:${topic}`, { config: { broadcast: { self: false } } })

  presenceCh.on('presence', { event: 'sync' }, () => {
    const state = presenceCh.presenceState() || {}
    handlers.onMembers?.(Object.values(state).flat().map(m => m.name || '?'))
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
        if (live) { scheduleReconnect() }
        else if (!settled) { settled = true; reject(err || new Error(status)) }
      }
    })
  })

  return Promise.all([subscribeOne(presenceCh, 'presence'), subscribeOne(bcastCh, 'broadcast')])
    .then(async () => {
      live = true
      retries = 0
      handlers.onStatus?.('connected')
      try { await presenceCh.track({ name: myName, user_id: me }) } catch {}
    })
}

function scheduleReconnect() {
  if (!live) return
  live = false
  handlers.onStatus?.('reconnecting')
  retries++
  const wait = Math.min(10000, 500 * 2 ** retries)
  setTimeout(async () => {
    if (!topic) return
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

export function myId() { return me }

export async function disconnect() {
  const p = presenceCh, b = bcastCh
  topic = null
  live = false
  presenceCh = null
  bcastCh = null
  if (p) { try { await p.untrack() } catch {}; try { await p.unsubscribe() } catch {} }
  if (b) { try { await b.unsubscribe() } catch {} }
}
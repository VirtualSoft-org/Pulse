import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let channel = null
let me = null
let myName = 'guest'
let topic = null
let live = false
let retries = 0
let handlers = {}

async function topicFor(roomId, passphrase) {
  const raw = `${roomId}::${passphrase || ''}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `pulse:${hex.slice(0, 24)}`
}

/** Join a room. handlers: { onEvent(e), onMembers(names[]), onStatus(state) } */
export async function connect(roomId, displayName, passphrase, h = {}) {
  handlers = h
  if (channel) await disconnect()

  let { data: { session } } = await sb.auth.getSession()
  if (!session) {
    const { data, error } = await sb.auth.signInAnonymously()
    if (error) throw error
    session = data.session
  }
  me = session.user.id
  myName = displayName || 'guest'
  topic = await topicFor(roomId, passphrase)
  retries = 0
  live = false
  await open()
  return me
}

function open() {
  channel = sb.channel(topic, {
    config: { broadcast: { self: false }, presence: { key: me } }
  })

  channel.on('broadcast', { event: 'e' }, ({ payload }) => {
    if (!payload || payload.from === me) return
    if (payload.to && payload.to !== me) return
    handlers.onEvent?.(payload)
  })

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState() || {}
    handlers.onMembers?.(Object.values(state).flat().map(m => m.name || '?'))
  })

  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('subscribe timeout')) } }, 8000)

    channel.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        live = true
        retries = 0
        handlers.onStatus?.('connected')
        try { await channel.track({ name: myName, user_id: me }) } catch {}
        if (!settled) { settled = true; resolve() }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timer)
        const wasLive = live
        live = false
        if (wasLive) {
          scheduleReconnect()          // dropped mid-session — retry quietly
        } else if (!settled) {
          settled = true
          reject(err || new Error(status))
        }
      }
    })
  })
}

function scheduleReconnect() {
  handlers.onStatus?.('reconnecting')
  retries++
  const wait = Math.min(10000, 500 * 2 ** retries)
  setTimeout(async () => {
    if (!topic) return   // user left in the meantime
    try { await open() } catch { scheduleReconnect() }
  }, wait)
}

function send(e) {
  if (!channel || !live) return Promise.resolve()
  return channel.send({ type: 'broadcast', event: 'e', payload: { ...e, from: me, name: myName } }).catch(() => {})
}

export const sendPlay    = at            => send({ t: 'play', at, sentAt: Date.now() })
export const sendPause   = at            => send({ t: 'pause', at })
export const sendChat    = text          => send({ t: 'chat', text })
export const sendSyncReq = (hash, at)    => send({ t: 'sync_req', hash, at })
export const sendSyncRes = (to, ok, off) => send({ t: 'sync_res', to, ok, offset: off })

export function myId() { return me }

export async function disconnect() {
  const ch = channel
  topic = null
  live = false
  channel = null
  if (ch) {
    try { await ch.untrack() } catch {}
    try { await ch.unsubscribe() } catch {}
  }
}
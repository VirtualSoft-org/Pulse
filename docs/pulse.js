import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.53.0/+esm'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage,       // per-tab auth, no localStorage collision
    storageKey: 'pulse.auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    // Bypass the Web Locks API. It's used to coordinate token refresh across
    // tabs, but each tab now has its own session, so there's nothing to
    // coordinate — and the lock was throwing on background tabs anyway.
    lock: async (_name, _timeout, fn) => fn(),
  },
})

let ch = null
let authId = null          // supabase anonymous user id (used only for auth)
let tabId = null           // per-tab identity (sessionStorage) — our real "me"
let myName = 'guest'
let myReady = false
let myJoinedAt = 0
let topic = null
let live = false
let retries = 0
let handlers = {}
let manualHostId = null
let manualHostAt = 0

const memberMap = new Map()   // tabId -> { name, ready, joinedAt, lastSeen }
let pollTimer = null

function initTabId() {
  let id = sessionStorage.getItem('pulse.tabId')
  if (!id) {
    id = (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2))
    sessionStorage.setItem('pulse.tabId', id)
  }
  return id
}

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
  // Manual override: pick the newest non-null hostHint across all members.
  let hintId = null, hintAt = 0
  for (const m of members) {
    if (m.hostHint && (m.hostHintAt || 0) > hintAt) {
      hintId = m.hostHint
      hintAt = m.hostHintAt || 0
    }
  }
  if (hintId && members.some(m => m.user_id === hintId)) return hintId
  // Fallback: earliest joinedAt.
  const sorted = [...members].sort((a, b) =>
    (a.joinedAt || 0) - (b.joinedAt || 0) ||
    String(a.user_id || '').localeCompare(String(b.user_id || ''))
  )
  return sorted[0].user_id || null
}

function retrack() {
  if (!ch || !live) return Promise.resolve()
  return ch.track({
    name: myName, ready: myReady, joinedAt: myJoinedAt,
    hostHint: manualHostId, hostHintAt: manualHostAt,
  }).catch(e => console.warn('[pulse] retrack failed', e))
}

function emitMembers() {
  if (tabId) {
    memberMap.set(tabId, {
      name: myName, ready: myReady, joinedAt: myJoinedAt,
      hostHint: manualHostId, hostHintAt: manualHostAt,
      lastSeen: Date.now(),
    })
  }

  if (ch) {
    const state = ch.presenceState() || {}
    for (const key of Object.keys(state)) {
      if (!key || key === tabId) continue
      for (const p of (state[key] || [])) {
        memberMap.set(key, {
          name: (p && p.name) || '?',
          ready: !!(p && p.ready),
          joinedAt: (p && p.joinedAt) || 0,
          hostHint: (p && p.hostHint) || null,
          hostHintAt: (p && p.hostHintAt) || 0,
          lastSeen: Date.now(),
        })
      }
    }
  }

  // prune entries we haven't seen in 30s (covers a tab that crashed without untracking)
  const now = Date.now()
  for (const [uid, m] of memberMap) {
    if (uid === tabId) continue
    if (now - m.lastSeen > 30000) memberMap.delete(uid)
  }

  const members = [...memberMap.entries()].map(([uid, m]) => ({
    user_id: uid, name: m.name, ready: m.ready, joinedAt: m.joinedAt,
    hostHint: m.hostHint || null, hostHintAt: m.hostHintAt || 0,
  }))

  handlers.onMembers?.(members)
  handlers.onHost?.(computeHost(members))
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(emitMembers, 3000)
}
function stopPoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

export async function connect(roomId, displayName, passphrase, h = {}) {
  handlers = h
  await disconnect()

  handlers.onProgress?.('Signing in…')
  let { data: { session } } = await sb.auth.getSession()
  if (!session) {
    const { data, error } = await sb.auth.signInAnonymously()
    if (error) throw new Error('auth: ' + error.message)
    session = data.session
  }
  authId = session.user.id
  tabId = initTabId()
  myName = displayName || 'guest'
  myReady = false
  myJoinedAt = Date.now()
  topic = topicFor(roomId, passphrase)
  retries = 0
  live = false
  memberMap.clear()

  const maxAttempts = 4
  let lastErr = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    handlers.onProgress?.(attempt === 1 ? 'Connecting to room…' : `Retrying… (${attempt}/${maxAttempts})`)
    try {
      await open()
      return tabId
    } catch (err) {
      lastErr = err
      console.warn('[pulse] connect attempt ' + attempt + ' failed:', err)
      await removeStale()
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 400 * attempt))
    }
  }
  throw lastErr || new Error('connect failed')
}

async function open() {
  await removeStale()   // ensure no lingering channel from a prior attempt
  ch = sb.channel(`pulse:${topic}`, {
    config: {
      presence: { key: tabId, enabled: true },
      broadcast: { self: false },
    },
  })

  ch.on('presence', { event: 'sync' }, () => emitMembers())
  ch.on('presence', { event: 'join' }, () => emitMembers())
  ch.on('presence', { event: 'leave' }, () => emitMembers())

  ch.on('broadcast', { event: 'e' }, ({ payload }) => {
    if (!payload || payload.from === tabId) return
    // host_transfer: `to` is the NEW host, not the recipient — handle before the filter.
    if (payload.t === 'host_transfer') {
      if (!payload.to) return
      manualHostId = payload.to
      manualHostAt = payload.at || Date.now()
      retrack().then(emitMembers)
      return
    }
    if (payload.to && payload.to !== tabId) return
    handlers.onEvent?.(payload)
  })

  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('subscribe timeout')) }
    }, 12000)

    ch.subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer)
        if (settled) return
        settled = true
        try {
          await retrack()
        } catch (e) {
          console.error('[pulse] track failed:', e)
        }
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timer)
        if (!settled) { settled = true; reject(err || new Error(status)) }
        else if (live) scheduleReconnect()
      }
    })
  }).then(() => {
    live = true
    retries = 0
    handlers.onStatus?.('connected')
    startPoll()
  })
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

async function removeStale() {
  if (ch) { try { await sb.removeChannel(ch) } catch {} }
  ch = null
}

function send(e) {
  if (!ch || !live) return Promise.resolve()
  return ch.send({ type: 'broadcast', event: 'e', payload: { ...e, from: tabId, name: myName } })
}

export const sendPlay     = at            => send({ t: 'play', at, sentAt: Date.now() })
export const sendPause    = at            => send({ t: 'pause', at })
export const sendSeek     = at            => send({ t: 'seek', at })
export const sendChat     = text          => send({ t: 'chat', text })
export const sendSyncReq  = (hash, at)    => send({ t: 'sync_req', hash, at })
export const sendSyncRes  = (to, ok, off) => send({ t: 'sync_res', to, ok, offset: off })
export const sendReaction = emoji         => send({ t: 'reaction', emoji })
export const sendPosReq   = ()            => send({ t: 'pos_req' })
export const sendPosRes   = (to, at, playing) => send({ t: 'pos_res', to, at, playing, sentAt: Date.now() })

export async function setReady(ready) {
  myReady = ready
  if (ch && live) {
    await retrack()
    emitMembers()
  }
}

export function myId() { return tabId }

export function transferHost(toTabId) {
  if (!toTabId || toTabId === tabId) return
  manualHostId = toTabId
  manualHostAt = Date.now()
  retrack().then(emitMembers)
  return send({ t: 'host_transfer', to: toTabId, at: manualHostAt })
}

export async function disconnect() {
  stopPoll()
  if (ch) { try { await ch.untrack() } catch {} }
  await removeStale()
  memberMap.clear()
  topic = null
  live = false
}

window.pulseDebug = {
  state: () => ({ presence: ch && ch.state, live, topic, tabId, authId }),
  members: () => Object.fromEntries(memberMap),
  presenceRaw: () => ch && ch.presenceState(),
  presencePretty: () => {
    const s = ch && ch.presenceState()
    return s ? JSON.stringify(s, null, 2) : '(no channel)'
  },
}
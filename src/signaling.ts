import { supabase } from './supabase'
import { ensureAuth } from './auth'

type SignalType = 'offer' | 'answer' | 'ice'

type SignalMessage = {
  from: string
  to: string
  type: SignalType
  data: any
}

let channel: any = null
let myUserId: string | null = null
let roomTopic: string | null = null
const listeners: Array<(msg: SignalMessage) => void> = []

/** Initialize signaling on the presence channel for `roomId`. */
export async function initSignaling(roomId: string) {
  if (!roomId) throw new Error('roomId is required')

  // close existing
  if (channel) await closeSignaling()

  myUserId = await ensureAuth()
  roomTopic = `room:${roomId}`

  // create a broadcast-enabled channel on the same presence topic
  channel = supabase.channel(roomTopic, { config: { broadcast: { self: true } } })

  // Listen for broadcasted 'signal' events
  channel.on('broadcast', { event: 'signal' }, (payload: any) => {
    try {
      const msg = payload?.payload as SignalMessage | undefined
      console.log('[signaling] received raw payload:', payload)
      if (!msg || typeof msg !== 'object') return

      // debug logging
      console.log('[signaling] received signal', msg)

      // ignore messages not addressed to me or originating from me
      if (!myUserId) return
      if (msg.from === myUserId) return
      if (msg.to !== myUserId) return

      // notify listeners
      for (const l of listeners) {
        try {
          l(msg)
        } catch (e) {
          console.error('[signaling] listener error', e)
        }
      }
    } catch (e) {
      console.error('[signaling] error processing incoming signal', e)
    }
  })

  // subscribe and await confirmation
  await new Promise<void>((resolve, reject) => {
    let settled = false
    channel.subscribe((status: any, err?: Error) => {
      if (settled) return
      if (err) {
        settled = true
        reject(err)
        return
      }
      if (status === 'SUBSCRIBED') {
        settled = true
        console.log(`[signaling] subscribed to ${roomTopic} as ${myUserId}`)
        resolve()
        return
      }
    })
    setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('subscribe timeout'))
      }
    }, 5000)
  })
}

/** Send a signaling message to `to` (userId). */
export async function sendSignal(to: string, type: SignalType, data: any) {
  if (!channel) throw new Error('signaling not initialized')
  if (!myUserId) throw new Error('not authenticated')
  if (!roomTopic) throw new Error('no room topic')

  const msg: SignalMessage = { from: myUserId, to, type, data }

  console.log('[signaling] sending', msg)

  try {
    const res = await channel.send({ type: 'broadcast', event: 'signal', payload: msg })
    console.log('[signaling] send result', res)
    return res
  } catch (e) {
    console.error('[signaling] send error', e)
    throw e
  }
}

/** Register a callback for incoming signals addressed to this user. */
export function onSignal(cb: (msg: SignalMessage) => void) {
  listeners.push(cb)
  return () => {
    const idx = listeners.indexOf(cb)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

/** Close the signaling channel and clear listeners. */
export async function closeSignaling() {
  try {
    if (channel) {
      try {
        await channel.unsubscribe()
      } catch (e) {
        console.error('[signaling] unsubscribe error', e)
      }
    }
  } finally {
    channel = null
    roomTopic = null
    myUserId = null
    listeners.length = 0
    console.log('[signaling] closed')
  }
}

export default { initSignaling, sendSignal, onSignal, closeSignaling }

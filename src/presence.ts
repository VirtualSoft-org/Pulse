import { supabase } from './supabase'
import { ensureAuth } from './auth'

// Use a loose type here to avoid tight realtime-js overload mismatches in this project
let channel: any = null
let tracked = false

/**
 * Join a presence channel for the given roomId and announce the current user with { user_id, role }.
 * Logs join/leave events to the console.
 */
export async function joinPresence(roomId: string, role: string) {
  if (!roomId) throw new Error('roomId is required')

  // leave existing channel if any
  if (channel) {
    await leavePresence()
  }

  // ensure we're authenticated and have a user id
  const userId = await ensureAuth()

  const topic = `presence:${roomId}`
  // enable presence on the channel
  channel = supabase.channel(topic, { config: { presence: { enabled: true } } })

  // presence event handlers (use any-typed payloads)
  channel.on('presence', { event: 'sync' }, () => {
    try {
      const state = channel.presenceState()
      console.log(`Presence sync for room ${roomId}:`, state)
    } catch (e) {
      console.log(`Presence sync (no state) for room ${roomId}`)
    }
  })

  channel.on('presence', { event: 'join' }, (payload: any) => {
    const { key, currentPresences, newPresences } = payload || {}
    console.log(`User joined (room=${roomId}) key=${key} current=`, currentPresences, 'new=', newPresences)
  })

  channel.on('presence', { event: 'leave' }, (payload: any) => {
    const { key, currentPresences, leftPresences } = payload || {}
    console.log(`User left (room=${roomId}) key=${key} left=`, leftPresences, 'current=', currentPresences)
  })

  // subscribe and wait for confirmation or error
  await new Promise<void>((resolve, reject) => {
    let settled = false
    channel.subscribe((status: any, err?: Error) => {
      if (settled) return
      if (err) {
        settled = true
        reject(err)
        return
      }
      // subscribed state is a string; accept SUBSCRIBED
      if (status === 'SUBSCRIBED') {
        settled = true
        resolve()
        return
      }
    })
    // safety timeout
    setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('subscribe timeout'))
      }
    }, 5000)
  })

  // track current user presence
  const trackRes = await channel.track({ user_id: userId, role })
  if (trackRes !== 'ok') {
    try {
      await channel.unsubscribe()
    } catch {}
    channel = null
    throw new Error(`track failed: ${String(trackRes)}`)
  }

  tracked = true
  console.log(`✅ User ${userId} joined presence for room ${roomId} as role=${role}`)
}

/**
 * Leave the currently-joined presence channel (if any).
 */
export async function leavePresence() {
  if (!channel) return

  try {
    if (tracked) {
      await channel.untrack()
      tracked = false
    }
  } catch (e) {
    // ignore untrack errors
    console.error('Error during untrack:', e)
  }

  try {
    await channel.unsubscribe()
  } catch (e) {
    console.error('Error unsubscribing presence channel:', e)
  }

  channel = null
  console.log('Left presence channel')
}

export default {
  joinPresence,
  leavePresence
}

import { supabase } from './supabase'
import { ensureAuth } from './auth'
import { leaveRoom } from './joinRoom'

// Use a loose type here to avoid tight realtime-js overload mismatches in this project
let channel: any = null
let tracked = false
let currentRoomId: string | null = null

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
      // Suppress verbose sync logs — only log on DEBUG
      if (process.env.DEBUG === 'true') {
        console.log(`Presence sync for room ${roomId}:`, state)
      }
    } catch (e) {
      // ignore
    }
  })

  channel.on('presence', { event: 'join' }, (payload: any) => {
    const { key, currentPresences, newPresences } = payload || {}
    if (process.env.DEBUG === 'true') {
      console.log(`User joined (room=${roomId}) key=${key} current=`, currentPresences, 'new=', newPresences)
    }
  })

  channel.on('presence', { event: 'leave' }, (payload: any) => {
    const { key, currentPresences, leftPresences } = payload || {}
    if (process.env.DEBUG === 'true') {
      console.log(`User left (room=${roomId}) key=${key} left=`, leftPresences, 'current=', currentPresences)
    }

    // Remove the membership row for the user who left so other processes can react
    ;(async () => {
      try {
        const leftUserId = key
        if (!leftUserId) return
        const { error } = await supabase
          .from('room_members')
          .delete()
          .match({ room_id: roomId, user_id: leftUserId })

        if (error) {
          console.warn('[presence] error deleting member on leave:', error)
        } else {
          console.log(`[presence] removed membership for ${leftUserId} from room ${roomId}`)
        }
      } catch (err) {
        console.error('[presence] unexpected error deleting member on leave:', err)
      }
    })()
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
  currentRoomId = roomId
  console.log(`✅ User ${userId} joined presence for room ${roomId} as role=${role}`)

  // Reconcile DB room_members with realtime presence state: remove any room_members
  // rows for users that are not present in the realtime presence state (stale rows).
  try {
    const state = channel.presenceState()
    const presentUserIds = new Set<string>()
    for (const key of Object.keys(state || {})) {
      const metas = state[key]
      if (Array.isArray(metas) && metas.length > 0) {
        const meta = metas[0]
        if (meta && meta.user_id) presentUserIds.add(meta.user_id)
      }
    }

    const { data: members, error: membersErr } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)

    if (!membersErr && Array.isArray(members)) {
      const toRemove: string[] = []
      for (const m of members) {
        if (!presentUserIds.has(m.user_id)) toRemove.push(m.user_id)
      }

      for (const uid of toRemove) {
        try {
          const { error: delErr } = await supabase
            .from('room_members')
            .delete()
            .match({ room_id: roomId, user_id: uid })

          if (delErr) console.warn('[presence] error deleting stale member', uid, delErr)
          else console.log('[presence] deleted stale room_member for', uid)
        } catch (err) {
          console.warn('[presence] unexpected error deleting stale member', uid, err)
        }
      }
    } else if (membersErr) {
      console.warn('[presence] error fetching room_members for reconciliation', membersErr)
    }
  } catch (err) {
    console.warn('[presence] error during presence->room_members reconciliation', err)
  }
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

  // remove membership row from DB so other members see the leave and host can be promoted
  if (currentRoomId) {
    try {
      await leaveRoom(currentRoomId)
    } catch (err) {
      console.warn('Error leaving room membership during presence.leavePresence:', err)
    }
    currentRoomId = null
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

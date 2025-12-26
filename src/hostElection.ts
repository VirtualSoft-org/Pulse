import { supabase } from './supabase'
import { ensureAuth } from './auth'

export type HostEvent = {
  type: 'host-elected'
  userId: string
  roomId: string
  timestamp: number
}

export async function getCurrentHost(roomId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('rooms')
    .select('host_id')
    .eq('id', roomId)
    .maybeSingle()

  if (error) {
    console.error('[hostElection] Error getting host:', error)
    return null
  }

  const host = data?.host_id || null
  console.log(`[hostElection] getCurrentHost(${roomId}) => ${host}`)
  return host
}

export async function electHost(roomId: string, userId: string): Promise<boolean> {
  try {
    console.log(`[hostElection] attempting electHost for ${userId} in room ${roomId}`)

    // Check current host first
    const current = await getCurrentHost(roomId)
    if (current) {
      console.log(`[hostElection] room already has host ${current}`)

      // If the recorded host is this user, we're done
      if (current === userId) return true

      // Check whether the current host is still present in room_members.
      // If not present, consider the host stale and attempt to claim it atomically.
      try {
        const { data: memberData, error: memberErr } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId)
          .eq('user_id', current)
          .maybeSingle()

        if (memberErr) {
          console.warn('[hostElection] Error checking current host presence:', memberErr)
        }

        const hostStillPresent = !!memberData
        if (!hostStillPresent) {
          console.log('[hostElection] detected stale host (not in room_members), attempting atomic claim')

          const { data: updated, error: updateErr } = await supabase
            .from('rooms')
            .update({ host_id: userId })
            .eq('id', roomId)
            .eq('host_id', current)
            .select('host_id')
            .maybeSingle()

          if (updateErr) {
            console.warn('[hostElection] atomic claim update error:', updateErr)
          } else if (updated && updated.host_id === userId) {
            console.log(`[hostElection] Successfully claimed stale host for ${userId}`)
            return true
          }
          // fallthrough to re-check below
        }
      } catch (err) {
        console.warn('[hostElection] error while checking/claiming stale host', err)
      }

      return false
    }

    // Try an atomic claim: only set host_id if it's currently null.
    // Use `.select()` so we can inspect whether an update actually affected a row.
    const { data: updated, error: updateErr } = await supabase
      .from('rooms')
      .update({ host_id: userId })
      .eq('id', roomId)
      .is('host_id', null)
      .select('host_id')
      .maybeSingle()

    console.log('[hostElection] atomic update result:', { updated, updateErr })

    if (updateErr) {
      // If update errored (e.g., RLS), try to create the room as a fallback
      console.warn('[hostElection] update error, attempting to create room:', updateErr.message || updateErr)
      const { error: createErr } = await supabase.from('rooms').insert({ id: roomId, host_id: userId })
      if (createErr) {
        console.error('[hostElection] Error creating room during electHost:', createErr)
        // fallthrough to re-check
      } else {
        console.log(`[hostElection] Created room and elected ${userId} as host for room ${roomId}`, { created: true })
        return true
      }
    } else if (updated && updated.host_id === userId) {
      // Successfully claimed host
      console.log(`[hostElection] Successfully set host for ${userId} in room ${roomId}`)
      return true
    } else {
      console.log('[hostElection] atomic update did not return claimed host; updated value:', updated)
      // No rows updated (room missing or host already set). If the room is missing, try to insert.
      // Check whether room exists at all; if not, create it with this host.
      const { data: roomRow, error: roomErr } = await supabase
        .from('rooms')
        .select('id,host_id')
        .eq('id', roomId)
        .maybeSingle()

      if (roomErr) {
        console.warn('[hostElection] error checking room existence:', roomErr)
      }

      if (!roomRow) {
        const { error: createErr2 } = await supabase.from('rooms').insert({ id: roomId, host_id: userId })
        if (createErr2) {
          console.error('[hostElection] Error creating room during electHost:', createErr2)
        } else {
          console.log(`[hostElection] Created room and elected ${userId} as host for room ${roomId}`)
          return true
        }
      }
      // otherwise fall through to final re-check
    }

    // Re-check who is host now
    const final = await getCurrentHost(roomId)
    console.log(`[hostElection] final host for room ${roomId} is ${final}`)
    return final === userId
  } catch (err) {
    console.error('[hostElection] Error electing host:', err)
    return false
  }
}

export async function amIHost(roomId: string): Promise<boolean> {
  try {
    const userId = await ensureAuth()
    console.log(`[hostElection] amIHost: checking for user ${userId} in room ${roomId}`)
    // Check if there's a current host
    const currentHost = await getCurrentHost(roomId)
    console.log(`[hostElection] amIHost: currentHost=${currentHost}`)

    if (!currentHost) {
      // No host exists, attempt to elect this user as host
      const elected = await electHost(roomId, userId)
      console.log(`[hostElection] amIHost: electHost returned ${elected}`)
      if (elected) return true

      // If electHost failed (likely DB/permissions), fall back to presence-based deterministic leader
      try {
        const leader = await computeHostFromPresence(roomId)
        console.log('[hostElection] amIHost: presence-based leader=', leader)
        return leader === userId
      } catch (err) {
        console.warn('[hostElection] amIHost: computeHostFromPresence failed', err)
        return false
      }
    }

    // If there's a host but it's not this user, check whether that host is still present.
    if (currentHost !== userId) {
      try {
        const { data: memberData, error: memberErr } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId)
          .eq('user_id', currentHost)
          .maybeSingle()

        if (memberErr) {
          console.warn('[hostElection] amIHost: error checking host presence', memberErr)
        }

        const hostStillPresent = !!memberData
        if (!hostStillPresent) {
          console.log('[hostElection] amIHost: detected stale host, attempting elect')
          const elected = await electHost(roomId, userId)
          console.log(`[hostElection] amIHost: electHost returned ${elected}`)
          if (elected) return true

          const leader = await computeHostFromPresence(roomId)
          console.log('[hostElection] amIHost: presence-based leader=', leader)
          return leader === userId
        }
      } catch (err) {
        console.warn('[hostElection] amIHost: error while checking host presence', err)
      }
    }

    // Return whether this user is the current host
    const isHost = currentHost === userId
    console.log(`[hostElection] amIHost: isHost=${isHost}`)
    return isHost
  } catch (error) {
    console.error('[hostElection] Error checking if host:', error)
    return false
  }
}

/**
 * Fallback: compute a deterministic host from realtime presence when DB-based
 * host assignment is unavailable (e.g., RLS prevents updates) or host_id is null.
 * Strategy: subscribe briefly to the presence channel, read presenceState, and
 * pick the lexicographically smallest `user_id` seen in presence metadata.
 */
export async function computeHostFromPresence(roomId: string): Promise<string | null> {
  try {
    const channel = supabase.channel(`presence:${roomId}`, { config: { presence: { enabled: true } } })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      channel.subscribe((status, err) => {
        if (settled) return
        if (err) {
          settled = true
          reject(err)
          return
        }
        if (status === 'SUBSCRIBED') {
          settled = true
          resolve()
          return
        }
      })
      setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('presence subscribe timeout'))
        }
      }, 3000)
    })

    // Wait for presence state to stabilize (allow incoming sync messages)
    await new Promise(r => setTimeout(r, 200))

    let state: any = {}
    try {
      state = channel.presenceState() || {}
    } catch (e) {
      console.warn('[hostElection] computeHostFromPresence: cannot read presenceState', e)
    }

    const seen = new Set<string>()
    for (const key of Object.keys(state || {})) {
      const metas = state[key]
      if (Array.isArray(metas) && metas.length > 0) {
        const meta = metas[0]
        if (meta && meta.user_id) seen.add(meta.user_id)
      }
    }

    // cleanup
    try {
      await channel.unsubscribe()
    } catch {}

    if (!seen.size) return null
    const list = Array.from(seen).sort()
    const leader = list[0]
    console.log(`[hostElection] computeHostFromPresence: leader=${leader} (${seen.size} members)`)
    return leader
  } catch (err) {
    console.warn('[hostElection] computeHostFromPresence error:', err)
    return null
  }
}

export async function listenForHostChanges(
  roomId: string,
  callback: (hostId: string | null) => void
) {
  // Subscribe to room updates
  const channel = supabase.channel(`room:${roomId}:host`)
  
  channel.on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${roomId}`
    },
    (payload) => {
      console.log('[hostElection] Host changed:', payload.new.host_id)
      callback(payload.new.host_id)
    }
  )

  const subscription = channel.subscribe((status) => {
    console.log('[hostElection] Subscription status:', status)
  })

  return () => {
    subscription.unsubscribe()
  }
}

/**
 * Monitor room_members for leaves. When a member leaves, log it and if the left member
 * was the host, attempt to promote the next available member (oldest join).
 */
export function listenForMemberLeaves(roomId: string) {
  const channel = supabase.channel(`room:${roomId}:members`)

  channel.on(
    'postgres_changes',
    {
      event: 'DELETE',
      schema: 'public',
      table: 'room_members',
      filter: `room_id=eq.${roomId}`
    },
    async (payload: any) => {
      try {
        const old = payload.old
        const leftUser = old?.user_id
        console.log('[hostElection] member left:', leftUser, 'from room', roomId)

        // Notify via console (other processes subscribed to this channel will see it via realtime)

        // Check current host
        const currentHost = await getCurrentHost(roomId)
        if (!currentHost) return

        if (currentHost === leftUser) {
          console.log('[hostElection] Host left; selecting next host...')

          // Find next candidate: earliest joined member
          try {
            const { data: rows, error: rowsErr } = await supabase
              .from('room_members')
              .select('user_id,created_at')
              .eq('room_id', roomId)
              .order('created_at', { ascending: true })
              .limit(1)

            if (rowsErr) {
              console.warn('[hostElection] error fetching next candidate:', rowsErr)
              return
            }

            const candidate = rows && rows.length ? rows[0].user_id : null
            if (!candidate) {
              console.log('[hostElection] no members left to promote; clearing host')
              await supabase.from('rooms').update({ host_id: null }).eq('id', roomId)
              return
            }

            // Try to atomically replace host only if host is still the departed user
            const { data: updated, error: updateErr } = await supabase
              .from('rooms')
              .update({ host_id: candidate })
              .eq('id', roomId)
              .eq('host_id', currentHost)
              .select('host_id')
              .maybeSingle()

            if (updateErr) {
              console.warn('[hostElection] error promoting candidate:', updateErr)
              return
            }

            if (updated && updated.host_id === candidate) {
              console.log(`[hostElection] promoted ${candidate} to host for room ${roomId}`)
            } else {
              console.log('[hostElection] promotion did not take effect (race or changed host)')
            }
          } catch (err) {
            console.error('[hostElection] error during promotion flow:', err)
          }
        }
      } catch (err) {
        console.error('[hostElection] member leave handler error:', err)
      }
    }
  )

  const subscription = channel.subscribe((status) => {
    console.log('[hostElection] member-leave subscription status:', status)
  })

  return () => subscription.unsubscribe()
}

export default {
  getCurrentHost,
  amIHost,
  electHost,
  listenForHostChanges
}
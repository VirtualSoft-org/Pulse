import { supabase as defaultSupabase } from './supabase'
import { ensureAuth } from './auth'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function joinRoom(roomId: string, client?: SupabaseClient) {
  const sb = client ?? defaultSupabase
  const userId = await ensureAuth(sb)
  console.log('Logged in as:', userId)

  // First, check if room exists
  const { data: roomExists } = await sb
    .from('rooms')
    .select('id')
    .eq('id', roomId)
    .maybeSingle()

  // If room doesn't exist, create it
  if (!roomExists) {
    console.log(`[joinRoom] Room ${roomId} doesn't exist, creating it...`)
    const { error: createError } = await sb
      .from('rooms')
      .insert({ id: roomId, host_id: userId })

    if (createError) {
      console.error('Create room failed:', createError)
      throw createError
    }
    console.log(`[joinRoom] Room ${roomId} created`)
  }

  // Now join the room
  const { error } = await sb
    .from('room_members')
    .insert({
      room_id: roomId,
      user_id: userId
    })

  if (error) {
    console.error('Join room failed:', error)
    return
  }

  // After joining, try to claim host atomically if no host is set.
  try {
    const { data: claimed, error: claimErr } = await sb
      .from('rooms')
      .update({ host_id: userId })
      .eq('id', roomId)
      .is('host_id', null)
      .select('host_id')
      .maybeSingle()

    if (claimErr) {
      console.warn('[joinRoom] host claim error:', claimErr)
    } else if (claimed && claimed.host_id === userId) {
      console.log(`[joinRoom] Claimed host for room ${roomId} as ${userId}`)
    }
  } catch (err) {
    console.warn('[joinRoom] error attempting host claim', err)
  }

  console.log(`✅ User ${userId} joined room ${roomId}`)
}

/**
 * Leave a room: remove membership and, if the leaving user was the host,
 * attempt to promote the next available member (oldest join) or clear host.
 */
export async function leaveRoom(roomId: string, client?: SupabaseClient) {
  const sb = client ?? defaultSupabase
  const userId = await ensureAuth(sb)

  try {
    const { error: delErr } = await sb
      .from('room_members')
      .delete()
      .match({ room_id: roomId, user_id: userId })

    if (delErr) {
      console.error('[leaveRoom] error deleting membership:', delErr)
      return
    }

    console.log(`[leaveRoom] ${userId} left room ${roomId}`)

    // If the leaving user was host, promote next candidate
    const { data: roomData, error: roomErr } = await sb
      .from('rooms')
      .select('host_id')
      .eq('id', roomId)
      .maybeSingle()

    if (roomErr) {
      console.warn('[leaveRoom] error fetching room row:', roomErr)
      return
    }

    if (!roomData) return

    const currentHost = roomData.host_id
    if (currentHost !== userId) return

    // Find next candidate (earliest join)
    const { data: rows, error: rowsErr } = await sb
      .from('room_members')
      .select('user_id,created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(1)

    if (rowsErr) {
      console.warn('[leaveRoom] error fetching next candidate:', rowsErr)
      return
    }

    const candidate = rows && rows.length ? rows[0].user_id : null

    if (!candidate) {
      // clear host
      await sb.from('rooms').update({ host_id: null }).eq('id', roomId)
      console.log('[leaveRoom] cleared host (no members left)')
      return
    }

    // Try atomic promotion
    const { data: updated, error: updateErr } = await sb
      .from('rooms')
      .update({ host_id: candidate })
      .eq('id', roomId)
      .eq('host_id', currentHost)
      .select('host_id')
      .maybeSingle()

    if (updateErr) {
      console.warn('[leaveRoom] error promoting candidate:', updateErr)
      return
    }

    if (updated && updated.host_id === candidate) {
      console.log(`[leaveRoom] promoted ${candidate} to host for room ${roomId}`)
    } else {
      console.log('[leaveRoom] promotion did not take effect (race or changed host)')
    }
  } catch (err) {
    console.error('[leaveRoom] unexpected error:', err)
  }
}

// CLI execution - only runs when called directly
async function main() {
  const ROOM_ID = process.argv[2]

  if (!ROOM_ID) {
    console.error('Usage: npx ts-node src/joinRoom.ts <room_id>')
    process.exit(1)
  }

  try {
    await joinRoom(ROOM_ID)
    process.exit(0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
}

// Only execute if run directly
if (require.main === module) {
  main()
}

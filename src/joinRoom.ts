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

  console.log(`✅ User ${userId} joined room ${roomId}`)
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

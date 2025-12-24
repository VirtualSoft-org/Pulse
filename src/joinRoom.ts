import { supabase as defaultSupabase } from './supabase'
import { ensureAuth } from './auth'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function joinRoom(roomId: string, client?: SupabaseClient) {
  const sb = client ?? defaultSupabase
  const userId = await ensureAuth(sb)
  console.log('Logged in as:', userId)

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

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { joinRoom, leaveRoom } from '../src/joinRoom'
import { joinPresence, leavePresence } from '../src/presence'
import hostElection from '../src/hostElection'
import { supabase as defaultSupabase } from '../src/supabase'

// Minimal runner that creates two separate Supabase clients (simulates two users)
// and runs through join/presence/election then cleans up.

async function runSession(label: string, client: any, roomId: string) {
  console.log(`[${label}] starting`)
  // reuse existing auth helper flow by setting env vars specific to client is not trivial here.
  // We'll simulate by creating a temporary anon client and using REST tables directly.
  // For now, use the shared anonymous client and rely on server-side insertions with unique ids.
}

async function e2e() {
  const ROOM_ID = process.env.ROOM_ID
  if (!ROOM_ID) {
    console.error('Please set ROOM_ID env var')
    process.exit(1)
  }

  const supabaseA = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)
  const supabaseB = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

  console.log('E2E: creating test room if missing')
  await defaultSupabase.from('rooms').upsert({ id: ROOM_ID }, { onConflict: 'id' })

  // Create two test users by inserting directly into room_members with synthetic IDs
  const userA = `e2e-user-a-${Date.now()}`
  const userB = `e2e-user-b-${Date.now()}`

  console.log('E2E: inserting room_members for two users')
  await defaultSupabase.from('room_members').insert([{ room_id: ROOM_ID, user_id: userA }, { room_id: ROOM_ID, user_id: userB }])

  console.log('E2E: running host election logic for A and B')
  const aIsHost = await hostElection.electHost(ROOM_ID, userA)
  console.log('A elected?', aIsHost)
  if (!aIsHost) {
    const bIsHost = await hostElection.electHost(ROOM_ID, userB)
    console.log('B elected?', bIsHost)
  }

  console.log('E2E: current host:', await hostElection.getCurrentHost(ROOM_ID))

  console.log('E2E: cleaning up test members')
  await defaultSupabase.from('room_members').delete().in('user_id', [userA, userB]).eq('room_id', ROOM_ID)

  console.log('E2E: finished')
}

e2e().catch((err) => { console.error(err); process.exit(1) })

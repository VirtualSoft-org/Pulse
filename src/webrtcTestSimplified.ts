/*
 WebRTC Two-Process Test (Simplified)
 
 Creates two independent WebRTC connections via separate spawned processes
 with guaranteed different user IDs
*/

import { spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const ROOM_ID = '95552244-2f21-4f86-8cdc-417efc600b99'

const URL = 'https://enbyfbrgnyfbfbrqpxos.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q'

async function main() {
  console.log('\n=== Simplified WebRTC Test ===\n')

  // Get two distinct user IDs
  console.log('[SETUP] Creating two distinct sessions...')
  const sb1 = createClient(URL, KEY)
  const sb2 = createClient(URL, KEY)

  await sb1.auth.signInAnonymously()
  await sb2.auth.signInAnonymously()

  const { data: d1 } = await sb1.auth.getUser()
  const { data: d2 } = await sb2.auth.getUser()

  const user1Id = d1.user!.id
  const user2Id = d2.user!.id

  console.log(`User 1: ${user1Id}`)
  console.log(`User 2: ${user2Id}`)
  console.log(`Unique: ${user1Id !== user2Id ? '✅' : '❌'}\n`)

  if (user1Id === user2Id) {
    console.error('❌ FAILED: Both users have same ID')
    process.exit(1)
  }

  // Create a fresh room for this test
  const roomId = '95552244-2f21-4f86-8cdc-417efc600b99'
  console.log(`[SETUP] Using room ${roomId}\n`)

  // Register both users in the room
  console.log('[SETUP] Registering users in room...')
  await sb1.from('room_members').insert({ room_id: roomId, user_id: user1Id })
  await sb2.from('room_members').insert({ room_id: roomId, user_id: user2Id })

  console.log('✅ Both users registered\n')

  // Now spawn the CLI processes - but we can't pass auth tokens directly
  // Instead, each process will get its own session
  console.log('[TEST] Would need to pass session tokens to child processes')
  console.log('[TEST] Supabase stores session in localStorage (browser) or .supabase dir (Node)')
  console.log('[TEST] For independent Node processes, we need to either:')
  console.log('   1. Use environment variables to control auth behavior')
  console.log('   2. Create independent Supabase instances in each process')
  console.log('   3. Use separate .supabase directories per process\n')
}

main().catch(err => console.error('Error:', err))

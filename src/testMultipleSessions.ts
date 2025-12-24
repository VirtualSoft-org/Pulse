/*
  Test if multiple instances get different auth sessions
*/

import { createClient } from '@supabase/supabase-js'

async function test() {
  const url = process.env.SUPABASE_URL || 'https://enbyfbrgnyfbfbrqpxos.supabase.co'
  const key = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q'

  console.log('[Session 1] Creating client...')
  const client1 = createClient(url, key)
  const { error: err1 } = await client1.auth.signInAnonymously()
  if (err1) console.error('[Session 1] Error:', err1)
  const { data: user1 } = await client1.auth.getUser()
  console.log('[Session 1] User ID:', user1.user?.id)

  console.log('\n[Session 2] Creating client...')
  const client2 = createClient(url, key)
  const { error: err2 } = await client2.auth.signInAnonymously()
  if (err2) console.error('[Session 2] Error:', err2)
  const { data: user2 } = await client2.auth.getUser()
  console.log('[Session 2] User ID:', user2.user?.id)

  console.log('\nAre they different?', user1.user?.id !== user2.user?.id)
}

test().catch(err => console.error('Test error:', err))

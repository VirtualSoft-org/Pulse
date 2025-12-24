#!/usr/bin/env node
/*
 WebRTC Test - Two terminals simulation
 
 Starts two WebRTC CLI instances communicating over Supabase Realtime
 Uses stdin to automate commands
*/

import { spawn } from 'node:child_process'
import { supabase } from './supabase'
import { ensureAuth } from './auth'

const ROOM_ID = '95552244-2f21-4f86-8cdc-417efc600b99'

const ENV_VARS = {
  SUPABASE_URL: 'https://enbyfbrgnyfbfbrqpxos.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYnlmYnJnbnlmYmZicnFweG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzQ2MjgsImV4cCI6MjA4MTgxMDYyOH0.WxFotoKNBKxg0Br31cKXuulJxB2G1CAqTlte_0O3J6Q',
  ROOM_ID
}

async function runTest() {
  console.log('\n=== WebRTC Two-Terminal Test ===\n')

  const env1 = {
    ...process.env,
    ...ENV_VARS,
    FORCE_HOST: 'true'
  }
  
  const env2 = {
    ...process.env,
    ...ENV_VARS,
    FORCE_HOST: 'false'
  }
  console.log('[TEST] Starting Host (Terminal 1) with FORCE_HOST=true...')
  const hostProcess = spawn('npx', ['ts-node', 'src/webrtcCli.ts'], {
    env: env1,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true
  })

  await new Promise(resolve => setTimeout(resolve, 3000))

  console.log('\n[TEST] Starting Client (Terminal 2) with FORCE_HOST=false...')
  const clientProcess = spawn('npx', ['ts-node', 'src/webrtcCli.ts'], {
    env: env2,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true
  })

  await new Promise(resolve => setTimeout(resolve, 5000))

  console.log('\n[TEST] Both processes initialized. Sending test commands...\n')

  // Send a broadcast message to test basic functionality
  hostProcess.stdin.write('/broadcast test message\n')

  await new Promise(resolve => setTimeout(resolve, 3000))

  console.log('\n[TEST] Test complete. Cleaning up...\n')
  hostProcess.stdin.write('/quit\n')
  clientProcess.stdin.write('/quit\n')

  await new Promise(resolve => setTimeout(resolve, 1000))
  hostProcess.kill()
  clientProcess.kill()

  console.log('\n✅ WebRTC test finished!\n')
  process.exit(0)
}

runTest().catch(err => {
  console.error('[TEST] Error:', err)
  process.exit(1)
})

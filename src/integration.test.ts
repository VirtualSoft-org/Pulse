import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { joinRoom } from './joinRoom'
import net from 'node:net'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY

function canConnect(host: string, port = 443, timeout = 3000): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let done = false
    const onDone = (res: boolean) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(res)
    }

    socket.setTimeout(timeout)
    socket.once('error', () => onDone(false))
    socket.once('timeout', () => onDone(false))
    socket.connect(port, host, () => onDone(true))
  })
}

describe('integration: authenticate → create room → join → verify membership', () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    it('skipped - SUPABASE_URL / SUPABASE_ANON_KEY not set', () => {
      console.warn('Skipping integration test; set SUPABASE_URL and SUPABASE_ANON_KEY')
    })
    return
  }

  const host = (() => {
    try {
      return new URL(SUPABASE_URL).hostname
    } catch {
      return null
    }
  })()

  if (!host) {
    it('skipped - SUPABASE_URL is invalid', () => {
      console.warn('Skipping integration test; SUPABASE_URL is invalid')
    })
    return
  }

  it('creates a room and another user joins it', async () => {
    const reachable = await canConnect(host, 443, 3000)
    if (!reachable) {
      console.warn(`Skipping integration test; cannot reach ${host}:443`)
      return
    }

    const clientA = createClient(SUPABASE_URL, SUPABASE_KEY)
    // Sign in and get user A
    await clientA.auth.signInAnonymously()
    const { data: ua } = await clientA.auth.getUser()
    const userA = ua.user?.id
    expect(userA).toBeTruthy()

    // Create a room as user A
    const { data: roomData, error: roomErr } = await clientA
      .from('rooms')
      .insert({ host_id: userA })
      .select()
      .single()
    expect(roomErr).toBeNull()
    const roomId = (roomData as any).id
    expect(roomId).toBeTruthy()

    // Create clientB and sign in as a different anonymous user
    const clientB = createClient(SUPABASE_URL, SUPABASE_KEY)
    await clientB.auth.signInAnonymously()
    const { data: ub } = await clientB.auth.getUser()
    const userB = ub.user?.id
    expect(userB).toBeTruthy()

    // Use the joinRoom helper with clientB
    await joinRoom(roomId, clientB)

    // Verify membership exists (query from clientA)
    const { data: members, error: membersErr } = await clientA
      .from('room_members')
      .select('*')
      .eq('room_id', roomId)
      .eq('user_id', userB)

    expect(membersErr).toBeNull()
    expect(Array.isArray(members) && members.length).toBeGreaterThan(0)

    // Cleanup: remove membership(s) and room
    await clientA.from('room_members').delete().eq('room_id', roomId)
    await clientA.from('rooms').delete().eq('id', roomId)
  })
})

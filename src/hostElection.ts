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

  return data?.host_id || null
}

export async function amIHost(roomId: string): Promise<boolean> {
  try {
    const userId = await ensureAuth()
    const currentHost = await getCurrentHost(roomId)
    return currentHost === userId
  } catch (error) {
    console.error('[hostElection] Error checking if host:', error)
    return false
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

export default {
  getCurrentHost,
  amIHost,
  listenForHostChanges
}
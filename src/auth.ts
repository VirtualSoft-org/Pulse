import { supabase as defaultSupabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function ensureAuth(client?: SupabaseClient): Promise<string> {
  const sb = client ?? defaultSupabase

  // try existing session
  const { data } = await sb.auth.getUser()

  if (data.user) {
    return data.user.id
  }

  // otherwise sign in anonymously
  const { error } = await sb.auth.signInAnonymously()
  if (error) {
    throw error
  }

  const { data: newData } = await sb.auth.getUser()
  if (!newData.user) {
    throw new Error('Auth failed')
  }

  return newData.user.id
}

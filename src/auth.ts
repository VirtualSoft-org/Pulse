import { supabase } from './supabase'

export async function ensureAuth(): Promise<string> {
  // try existing session
  const { data } = await supabase.auth.getUser()

  if (data.user) {
    return data.user.id
  }

  // otherwise sign in anonymously
  const { error } = await supabase.auth.signInAnonymously()
  if (error) {
    throw error
  }

  const { data: newData } = await supabase.auth.getUser()
  if (!newData.user) {
    throw new Error('Auth failed')
  }

  return newData.user.id
}

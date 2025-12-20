import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE env vars')
  }

  return createClient(url, key)
}

export const supabase = createSupabaseClient()

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

async function main() {
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  console.log('logged in:', data.user?.id)
}

main()

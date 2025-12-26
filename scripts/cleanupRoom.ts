import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ROOM_ID = process.env.ROOM_ID || process.argv[2]

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars')
  process.exit(2)
}
if (!ROOM_ID) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... ROOM_ID=<room> node scripts/cleanupRoom.ts')
  process.exit(2)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('Cleaning room:', ROOM_ID)

  const { data: clearHost, error: clearErr } = await supabase
    .from('rooms')
    .update({ host_id: null })
    .eq('id', ROOM_ID)
    .select('id,host_id')
    .maybeSingle()

  if (clearErr) {
    console.error('Error clearing host:', clearErr)
  } else {
    console.log('Cleared host:', clearHost)
  }

  const { data: removed, error: removeErr } = await supabase
    .from('room_members')
    .delete()
    .eq('room_id', ROOM_ID)

  if (removeErr) {
    console.error('Error removing members:', removeErr)
  } else {
    console.log('Removed members result:', removed)
  }

  console.log('Cleanup complete')
}

main().catch(err => { console.error(err); process.exit(1) })

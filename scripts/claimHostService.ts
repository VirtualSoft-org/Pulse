import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ROOM_ID = process.env.ROOM_ID || process.argv[2]
const USER_ID = process.env.USER_ID || process.argv[3]

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars')
  process.exit(2)
}
if (!ROOM_ID || !USER_ID) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... ROOM_ID=<room> USER_ID=<user> node scripts/claimHostService.ts')
  process.exit(2)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('Attempting atomic claim for', USER_ID, 'in room', ROOM_ID)

  // Try atomic update where host_id IS NULL
  const { data, error } = await supabase
    .from('rooms')
    .update({ host_id: USER_ID })
    .eq('id', ROOM_ID)
    .is('host_id', null)
    .select('id,host_id')
    .maybeSingle()

  if (error) {
    console.error('Atomic update error:', error)
    process.exit(1)
  }

  console.log('Atomic update result:', data)

  if (data && data.host_id === USER_ID) {
    console.log('Successfully claimed host via atomic update')
    process.exit(0)
  }

  // If atomic update didn't set host, perhaps the room row doesn't exist.
  const { data: roomRow, error: roomErr } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', ROOM_ID)
    .maybeSingle()

  if (roomErr) {
    console.error('Error checking room row:', roomErr)
    process.exit(1)
  }

  if (!roomRow) {
    const { data: insertData, error: insertErr } = await supabase
      .from('rooms')
      .insert({ id: ROOM_ID, host_id: USER_ID })
      .select('id,host_id')
      .maybeSingle()

    if (insertErr) {
      console.error('Error inserting room row:', insertErr)
      process.exit(1)
    }

    console.log('Inserted room and set host:', insertData)
    process.exit(0)
  }

  console.log('Host was not claimed (either already set or race). Current room row:', roomRow)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })

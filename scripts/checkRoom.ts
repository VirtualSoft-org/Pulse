import 'dotenv/config'
import { supabase } from '../src/supabase'

async function main() {
  const roomId = process.env.ROOM_ID || process.argv[2]
  if (!roomId) {
    console.error('Usage: ROOM_ID=... npx ts-node scripts/checkRoom.ts')
    process.exit(2)
  }

  console.log('Fetching room:', roomId)
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single()

  if (error) {
    console.error('Error fetching room:', error)
    process.exit(1)
  }

  console.log('Room row:')
  console.log(JSON.stringify(data, null, 2))

  console.log('\nMembers in room:')
  const { data: members, error: membersErr } = await supabase
    .from('room_members')
    .select('*')
    .eq('room_id', roomId)

  if (membersErr) {
    console.error('Error fetching members:', membersErr)
    return
  }

  console.log(JSON.stringify(members, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

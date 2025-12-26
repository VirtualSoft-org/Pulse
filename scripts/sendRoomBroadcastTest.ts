import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const ROOM = process.env.ROOM_ID || process.argv[2]

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY')
  process.exit(2)
}
if (!ROOM) {
  console.error('Usage: ROOM_ID=<room> node scripts/sendRoomBroadcastTest.ts')
  process.exit(2)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function main() {
  const channel = supabase.channel(`room:${ROOM}`, { config: { broadcast: { self: false } } })
  try {
    const res = await channel.send({ type: 'broadcast', event: 'signal', payload: { from: 'test-script', to: 'all', type: 'chat', data: { text: 'hello room' } } })
    console.log('sent', res)
  } catch (e) {
    console.error('send failed', e)
  } finally {
    try { await channel.unsubscribe() } catch {}
  }
}

main().catch(e => { console.error(e); process.exit(1) })

import { supabase } from './supabase'
import { ensureAuth } from './auth'

async function createRoom() {
  const userId = await ensureAuth()
  console.log('Logged in as:', userId)

  const { data, error } = await supabase
    .from('rooms')
    .insert({ host_id: userId })
    .select()
    .single()

  if (error) {
    console.error('Create room failed:', error)
    return
  }

  console.log('✅ Room created:', data.id)
}

createRoom()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e)
    process.exit(1)
  })

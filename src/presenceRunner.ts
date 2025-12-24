import { joinPresence, leavePresence } from './presence'

const ROOM_ID = process.env.ROOM_ID ?? 'PUT_A_REAL_ROOM_ID_HERE'

async function run() {
  try {
    await joinPresence(ROOM_ID, 'member')
    console.log('Connected to presence — will leave after 10s')

    setTimeout(() => {
      leavePresence()
        .then(() => {
          console.log('Left presence; exiting')
          process.exit(0)
        })
        .catch(err => {
          console.error('Error leaving presence:', err)
          process.exit(1)
        })
    }, 10000)
  } catch (err) {
    console.error('Error joining presence:', err)
    process.exit(1)
  }
}

run()

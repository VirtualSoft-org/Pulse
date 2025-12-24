/*
 Interactive WebRTC DataChannel CLI
 
 Commands:
   /connect <peerId>     - Host: create peer connection and send offer
   /send <peerId> <msg>  - Send message to peer
   /broadcast <msg>      - Send message to all connected peers
   /close <peerId>       - Close peer connection
   /help                 - Show commands
   /quit                 - Exit
*/

import { initWebRTC, connectToPeer, sendToPeer, broadcast, closePeer } from './webrtc'
import { initSignaling } from './signaling'
import { joinRoom } from './joinRoom'
import * as readline from 'node:readline'

const roomId = process.env.ROOM_ID ?? process.argv[2]

function printHelp() {
  console.log('\n=== WebRTC DataChannel CLI ===')
  console.log('Commands:')
  console.log('  /connect <peerId>     - Host: create peer connection and send offer')
  console.log('  /send <peerId> <msg>  - Send message to peer')
  console.log('  /broadcast <msg>      - Send message to all connected peers')
  console.log('  /close <peerId>       - Close peer connection')
  console.log('  /help                 - Show this help')
  console.log('  /quit                 - Exit')
  console.log('')
}

async function interactiveLoop() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout as any })
  rl.setPrompt('> ')
  rl.prompt()

  rl.on('line', async line => {
    const trimmed = line.trim()
    if (!trimmed) {
      rl.prompt()
      return
    }

    if (trimmed === '/quit') {
      rl.close()
      process.exit(0)
      return
    }

    if (trimmed === '/help') {
      printHelp()
      rl.prompt()
      return
    }

    const parts = trimmed.split(' ')
    const cmd = parts[0]

    try {
      if (cmd === '/connect') {
        if (parts.length < 2) {
          console.log('Usage: /connect <peerId>')
          rl.prompt()
          return
        }
        const peerId = parts[1]
        console.log(`[CLI] connecting to peer ${peerId}...`)
        await connectToPeer(peerId)
        console.log(`[CLI] offer sent to ${peerId}`)
      } else if (cmd === '/send') {
        if (parts.length < 3) {
          console.log('Usage: /send <peerId> <message>')
          rl.prompt()
          return
        }
        const peerId = parts[1]
        const msg = parts.slice(2).join(' ')
        sendToPeer(peerId, msg)
        console.log(`[CLI] sent to ${peerId}: ${msg}`)
      } else if (cmd === '/broadcast') {
        if (parts.length < 2) {
          console.log('Usage: /broadcast <message>')
          rl.prompt()
          return
        }
        const msg = parts.slice(1).join(' ')
        broadcast(msg)
        console.log(`[CLI] broadcast: ${msg}`)
      } else if (cmd === '/close') {
        if (parts.length < 2) {
          console.log('Usage: /close <peerId>')
          rl.prompt()
          return
        }
        const peerId = parts[1]
        await closePeer(peerId)
        console.log(`[CLI] closed peer ${peerId}`)
      } else {
        console.log(`Unknown command: ${cmd}. Type /help for commands.`)
      }
    } catch (e) {
      console.error(`[CLI] error: ${(e as any).message}`)
    }

    rl.prompt()
  })

  rl.on('close', () => {
    process.exit(0)
  })
}

async function main() {
  if (!roomId) {
    console.error('Usage: ts-node src/webrtcCli.ts <roomId>')
    console.error('or: ROOM_ID=<roomId> ts-node src/webrtcCli.ts')
    process.exit(1)
  }

  try {
    console.log(`[CLI] joining room ${roomId}...`)
    await joinRoom(roomId)

    console.log(`[CLI] initializing signaling for room ${roomId}...`)
    await initSignaling(roomId)

    console.log(`[CLI] initializing WebRTC...`)
    await initWebRTC(roomId)

    console.log(`[CLI] WebRTC ready. Type /help for commands.`)
    printHelp()

    await interactiveLoop()
  } catch (err) {
    console.error('CLI error', err)
    process.exit(1)
  }
}

main()

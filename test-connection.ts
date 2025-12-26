/**
 * Simple test to verify host/client connection
 * Run in two terminals:
 * Terminal 1: FORCE_HOST=true npx ts-node test-connection.ts
 * Terminal 2: FORCE_HOST=false npx ts-node test-connection.ts
 */

import { initWebRTC, sendToPeer, broadcast, onMessage, getConnectedPeers } from './src/webrtc'
import { initSignaling } from './src/signaling'
import { joinRoom } from './src/joinRoom'
import { joinPresence } from './src/presence'
import { amIHost } from './src/hostElection'
import { log } from './src/logger'
import * as readline from 'node:readline'

const roomId = process.env.ROOM_ID ?? '95552244-2f21-4f86-8cdc-417efc600b99'

async function main() {
  try {
    console.log('\n=== WebRTC Test ===\n')
    log.info('test', `Room: ${roomId}`)

    log.info('test', 'Joining room...')
    await joinRoom(roomId)

    log.info('test', 'Joining presence...')
    await joinPresence(roomId, 'member')

    log.info('test', 'Initializing signaling...')
    await initSignaling(roomId)

    // Wait for presence to stabilize
    await new Promise(r => setTimeout(r, 500))
    const isHost = await amIHost(roomId)
    log.success('test', `Role: ${isHost ? '🎙️ HOST' : '👤 CLIENT'}`)

    log.info('test', 'Initializing WebRTC...')
    await initWebRTC(roomId)

    // Set up message handler
    onMessage((msg, peerId) => {
      log.info('test', `Message from ${peerId.substring(0, 8)}: ${JSON.stringify(msg)}`)
    })

    console.log('')
    log.info('test', 'Ready. Commands: /connect <peerId>, /broadcast <msg>, /send <peerId> <msg>, /quit')
    console.log('')

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.setPrompt('> ')
    rl.prompt()

    rl.on('line', async (line) => {
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

      const parts = trimmed.split(' ')
      const cmd = parts[0]

      try {
        if (cmd === '/connect') {
          const peerId = parts[1]
          if (!peerId) {
            log.warn('test', 'Usage: /connect <peerId>')
          } else {
            log.info('test', `Connecting to ${peerId.substring(0, 8)}...`)
            await (require('./src/webrtc').connectToPeer)(peerId)
          }
        } else if (cmd === '/broadcast') {
          const msg = parts.slice(1).join(' ')
          const peers = getConnectedPeers()
          if (peers.length === 0) {
            log.warn('test', 'no connected peers')
          } else {
            broadcast({ type: 'chat', text: msg })
            log.success('test', `broadcast to ${peers.length} peer(s): ${msg}`)
          }
        } else if (cmd === '/send') {
          const peerId = parts[1]
          const msg = parts.slice(2).join(' ')
          sendToPeer(peerId, { type: 'chat', text: msg })
          log.success('test', `sent to ${peerId.substring(0, 8)}: ${msg}`)
        } else {
          console.log(`Unknown command: ${cmd}. Try /connect, /broadcast, /send, /quit`)
        }
      } catch (e: any) {
        log.error('test', e.message)
      }

      rl.prompt()
    })
  } catch (err: any) {
    log.error('test', err.message)
    process.exit(1)
  }
}

main()

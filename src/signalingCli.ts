import { initSignaling, sendSignal, onSignal, closeSignaling } from './signaling'
import readline from 'node:readline'

// Usage:
//   ts-node src/signalingCli.ts <roomId> [targetUserId] [type]
// If only <roomId> is provided (or TARGET_ID is 'interactive'), the CLI enters interactive mode.

const roomId = process.env.ROOM_ID ?? process.argv[2]
const targetIdArg = process.env.TARGET_ID ?? process.argv[3]
const typeArg = process.env.TYPE ?? process.argv[4] ?? 'offer'

function printHelp() {
  console.log('Commands:')
  console.log("  <to> <type> <json>   - send message to user <to> (type: offer|answer|ice). JSON is optional data or a JSON string.")
  console.log("  /help                - show this help")
  console.log("  /quit                - exit")
}

async function interactiveLoop(unsub: () => void) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
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
      unsub()
      await closeSignaling()
      process.exit(0)
      return
    }
    if (trimmed === '/help') {
      printHelp()
      rl.prompt()
      return
    }

    // parse: expect: to type data
    const parts = trimmed.split(' ')
    if (parts.length < 2) {
      console.log('Invalid. Use: <to> <type> <json-data>')
      rl.prompt()
      return
    }
    const to = parts[0]
    const type = parts[1] as any
    const rest = parts.slice(2).join(' ')
    let data: any = rest || { text: '(empty)' }
    if (rest) {
      try {
        data = JSON.parse(rest)
      } catch {
        data = rest
      }
    }

    try {
      await sendSignal(to, type, data)
      console.log('[CLI] sent')
    } catch (e) {
      console.error('[CLI] send failed', e)
    }

    rl.prompt()
  })

  rl.on('close', async () => {
    unsub()
    await closeSignaling()
    process.exit(0)
  })
}

async function main() {
  if (!roomId) {
    console.error('Usage: ts-node src/signalingCli.ts <roomId> [targetUserId] [type]')
    process.exit(1)
  }

  await initSignaling(roomId)

  const unsub = onSignal(msg => {
    console.log('[CLI] incoming signal:', JSON.stringify(msg, null, 2))
  })

  // If a targetIdArg is provided and not 'interactive', send one test message and exit shortly.
  if (targetIdArg && targetIdArg !== 'interactive') {
    console.log(`[CLI] sending test ${typeArg} to ${targetIdArg}`)
    try {
      await sendSignal(targetIdArg, typeArg as any, { test: true, ts: Date.now() })
      console.log('[CLI] sent')
    } catch (e) {
      console.error('[CLI] send failed', e)
    }

    // keep alive briefly to observe responses
    setTimeout(async () => {
      unsub()
      await closeSignaling()
      process.exit(0)
    }, 5000)
    return
  }

  // Otherwise enter interactive mode
  console.log('[CLI] interactive mode — type /help for commands')
  await interactiveLoop(unsub)
}

main().catch(err => {
  console.error('CLI error', err)
  process.exit(1)
})

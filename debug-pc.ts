/**
 * Quick debug script to test wrtc RTCPeerConnection state on creation
 */
const wrtc = require('wrtc')

async function test() {
  console.log('Test 1: Immediate use after creation')
  const pc1 = new wrtc.RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  })

  console.log(`PC1 created:`)
  console.log(`  signalingState: ${pc1.signalingState}`)
  console.log(`  connectionState: ${pc1.connectionState}`)

  try {
    const dc1 = pc1.createDataChannel('data')
    console.log(`✓ DataChannel created`)
  } catch (e) {
    console.error(`✗ Failed to create data channel:`, (e as any).message)
  }

  console.log('\nTest 2: After waiting 100ms')
  const pc2 = new wrtc.RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  })
  
  await new Promise(r => setTimeout(r, 100))
  
  console.log(`PC2 after wait:`)
  console.log(`  signalingState: ${pc2.signalingState}`)
  console.log(`  connectionState: ${pc2.connectionState}`)

  try {
    const dc2 = pc2.createDataChannel('data')
    console.log(`✓ DataChannel created`)
  } catch (e) {
    console.error(`✗ Failed to create data channel:`, (e as any).message)
  }

  pc1.close()
  pc2.close()
}

test().catch(console.error)


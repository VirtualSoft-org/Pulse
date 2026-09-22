const W = 16, H = 16                    // 16x16 dHash = 240 bits (packed to 60 hex chars)
let canvas, ctx
function getCtx() {
  if (ctx) return ctx
  canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  ctx = canvas.getContext('2d', { willReadFrequently: true })
  return ctx
}

/**
 * Frame fingerprint. 16x16 luminance grid, horizontal difference hash.
 * Larger than the original 8x8 so that cross-decoder noise is a smaller
 * fraction of the total bit count — a 1-frame mismatch that flipped 12/64
 * bits on the old hash flips ~12/240 on this one, well under threshold.
 */
export function hashFrame(video) {
  if (!video.videoWidth) return null
  const cw = video.videoWidth, ch = video.videoHeight
  const c = getCtx()
  // Crop borders: sides 10%, top 8%, bottom 20% (dodges letterboxing,
  // station logos, and burned-in subtitles).
  c.drawImage(video, cw * 0.10, ch * 0.08, cw * 0.80, ch * 0.72, 0, 0, W, H)
  const d = c.getImageData(0, 0, W, H).data
  const g = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++)
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]

  // Horizontal neighbour comparison: W-1 bits per row, H rows = 240 bits.
  // Padded to 60 hex chars (240/4 = 60).
  let bits = ''
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W - 1; x++)
      bits += g[y * W + x] > g[y * W + x + 1] ? '1' : '0'

  let hex = ''
  for (let i = 0; i < bits.length; i += 4)
    hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16)
  return hex
}

const HASH_BITS = (W - 1) * H   // 240

export function distance(a, b) {
  if (!a || !b || a.length !== b.length) return HASH_BITS
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

/**
 * Seek and wait for the browser to actually present the new frame.
 * Without this, drawImage() right after `seeked` often reads the OLD
 * frame — the single biggest reason identical files failed to match.
 */
function seek(video, t) {
  return new Promise(resolve => {
    let done = false
    const fin = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', fin)
      // requestVideoFrameCallback fires exactly when a new frame is
      // presented — the correct signal that drawImage will read it.
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => resolve())
      } else {
        // Fallback: two rAFs (one to schedule, one to ensure paint).
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }
    }
    video.addEventListener('seeked', fin)
    video.currentTime = t
    setTimeout(fin, 900)
  })
}

async function scan(video, center, half, step, targetHash, best) {
  const dur = video.duration || 1e9
  for (let dt = -half; dt <= half + 1e-6; dt += step) {
    const t = Math.max(0, Math.min(dur, center + dt))
    await seek(video, t)
    // If the browser clamped us to a keyframe we didn't ask for, skip —
    // otherwise we hash the wrong moment and pollute the best-match track.
    if (Math.abs(video.currentTime - t) > 0.2) continue
    const dist = distance(hashFrame(video), targetHash)
    if (dist < best.d) {
      best.d = dist
      best.t = video.currentTime
      if (dist <= 8) return true
    }
  }
  return false
}

/**
 * Two-pass search:
 *   coarse: ±45s @ 2.5s steps  (~37 seeks)
 *   fine:   ±3s  @ 0.35s steps (~18 seeks) — only if coarse found a
 *           candidate under 80/240 bits
 * Threshold for "match": 60/240 bits (25%). Random 240-bit hashes differ
 * by ~50% on average, so 25% is still an extremely strong signal.
 */
export async function findOffset(video, targetHash, opts = {}) {
  const coarseHalf = opts.coarseWindow ?? 45
  const coarseStep = opts.coarseStep  ?? 2.5
  const fineHalf   = opts.fineWindow   ?? 3
  const fineStep   = opts.fineStep     ?? 0.35
  const threshold  = opts.threshold    ?? 60

  const wasPlaying = !video.paused
  const origin = video.currentTime
  video.pause()

  const best = { d: 999, t: null }
  try {
    const early = await scan(video, origin, coarseHalf, coarseStep, targetHash, best)
    if (!early && best.t !== null && best.d <= 100) {
      await scan(video, best.t, fineHalf, fineStep, targetHash, best)
    }
  } finally {
    await seek(video, origin)
    if (wasPlaying) video.play().catch(() => {})
  }

  return best.d <= threshold
    ? { ok: true, localTime: best.t, distance: best.d, max: HASH_BITS }
    : { ok: false, distance: best.d, max: HASH_BITS }
}
const W = 9, H = 8                     // 8x8 dHash = 64 bits
const canvas = document.createElement('canvas')
canvas.width = W; canvas.height = H
const ctx = canvas.getContext('2d', { willReadFrequently: true })

/** Tiny resolution-independent hash of the frame currently shown. */
export function hashFrame(video) {
  if (!video.videoWidth) return null
  const cw = video.videoWidth, ch = video.videoHeight
  // crop borders: sides 10%, top 8%, bottom 20% (dodges letterboxing + subtitles)
  ctx.drawImage(video, cw * 0.10, ch * 0.08, cw * 0.80, ch * 0.72, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  const g = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++)
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]

  let bits = ''
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W - 1; x++)
      bits += g[y * W + x] > g[y * W + x + 1] ? '1' : '0'

  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

export function distance(a, b) {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

function seek(video, t) {
  return new Promise(resolve => {
    let done = false
    const fin = () => { if (done) return; done = true; video.removeEventListener('seeked', fin); resolve() }
    video.addEventListener('seeked', fin)
    video.currentTime = t
    setTimeout(fin, 400)
  })
}

/**
 * One-time Sync: step through a small window around the current position,
 * looking for the frame matching `targetHash`. Restores position when done.
 */
export async function findOffset(video, targetHash, opts = {}) {
  const win = opts.window ?? 6, step = opts.step ?? 0.5, max = opts.threshold ?? 12
  const wasPlaying = !video.paused
  const origin = video.currentTime
  video.pause()

  let best = { d: 65, t: null }
  try {
    for (let dt = -win; dt <= win + 1e-6; dt += step) {
      const t = Math.max(0, Math.min(video.duration || 1e9, origin + dt))
      await seek(video, t)
      const d = distance(hashFrame(video), targetHash)
      if (d < best.d) best = { d, t }
      if (d <= 4) break
    }
  } finally {
    await seek(video, origin)
    if (wasPlaying) video.play().catch(() => {})
  }

  return best.d <= max
    ? { ok: true, localTime: best.t, distance: best.d }
    : { ok: false, distance: best.d }
}
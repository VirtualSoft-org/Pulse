import { describe, it, expect } from 'vitest'
import { distance } from './fingerprint.js'

describe('distance (hamming distance between dHash hex strings)', () => {
  it('returns 0 for identical hashes', () => {
    expect(distance('0123456789abcdef', '0123456789abcdef')).toBe(0)
  })

  it('returns 64 when either side is missing', () => {
    expect(distance(null, '0123456789abcdef')).toBe(64)
    expect(distance('0123456789abcdef', null)).toBe(64)
    expect(distance(undefined, undefined)).toBe(64)
  })

  it('returns 64 for length mismatch', () => {
    expect(distance('abc', 'abcd')).toBe(64)
  })

  it('counts differing bits inside a single hex digit', () => {
    expect(distance('0', '1')).toBe(1)   // 0000 vs 0001
    expect(distance('0', 'f')).toBe(4)   // 0000 vs 1111
    expect(distance('3', 'c')).toBe(4)   // 0011 vs 1100
  })

  it('sums bit differences across a full 16-char hash', () => {
    expect(distance('0000000000000000', 'ffffffffffffffff')).toBe(64)
  })

  it('is symmetric', () => {
    const a = 'a1b2c3d4e5f60718'
    const b = '1122334455667788'
    expect(distance(a, b)).toBe(distance(b, a))
  })
})
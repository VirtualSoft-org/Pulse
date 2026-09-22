import { describe, it, expect } from 'vitest'
import { distance } from './fingerprint.js'

// hashFrame produces 60 hex chars (240 bits). distance treats any
// length-consistent pair the same way; tests use 60-char strings.
const A = '0'.repeat(60)
const B = 'f'.repeat(60)
const C = 'a1b2c3d4e5f60718'.repeat(4).slice(0, 60)

describe('distance (hamming distance between dHash hex strings)', () => {
  it('returns 0 for identical hashes', () => {
    expect(distance(A, A)).toBe(0)
    expect(distance(C, C)).toBe(0)
  })

  it('returns 240 when either side is missing', () => {
    expect(distance(null, A)).toBe(240)
    expect(distance(A, null)).toBe(240)
    expect(distance(undefined, undefined)).toBe(240)
  })

  it('returns 240 for length mismatch', () => {
    expect(distance('abc', 'abcd')).toBe(240)
  })

  it('counts differing bits inside a single hex digit', () => {
    expect(distance('0' + '0'.repeat(59), '1' + '0'.repeat(59))).toBe(1)
    expect(distance('0' + '0'.repeat(59), 'f' + '0'.repeat(59))).toBe(4)
    expect(distance('3' + '0'.repeat(59), 'c' + '0'.repeat(59))).toBe(4)
  })

  it('sums bit differences across a full hash', () => {
    expect(distance(A, B)).toBe(240)
  })

  it('is symmetric', () => {
    expect(distance(A, C)).toBe(distance(C, A))
  })
})
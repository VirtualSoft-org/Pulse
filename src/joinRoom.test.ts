import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock modules BEFORE any imports that depend on them
vi.mock('./auth')
vi.mock('./supabase')

import { joinRoom } from './joinRoom'
import * as authModule from './auth'
import * as supabaseModule from './supabase'

const mockEnsureAuth = vi.mocked(authModule.ensureAuth)
const mockSupabase = vi.mocked(supabaseModule.supabase, { partial: true })

describe('joinRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.from = vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null })
    })
  })

  it('should successfully join a room with valid credentials', async () => {
    const userId = 'user-123'
    const roomId = 'room-456'

    mockEnsureAuth.mockResolvedValue(userId)

    await joinRoom(roomId)

    expect(mockEnsureAuth).toHaveBeenCalled()
    expect(mockSupabase.from).toHaveBeenCalledWith('room_members')
  })

  it('should handle insert errors gracefully', async () => {
    const userId = 'user-123'
    const roomId = 'room-456'
    const dbError = { message: 'Duplicate entry' }

    mockEnsureAuth.mockResolvedValue(userId)
    mockSupabase.from = vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: dbError })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await joinRoom(roomId)

    expect(consoleSpy).toHaveBeenCalledWith('Join room failed:', dbError)
    consoleSpy.mockRestore()
  })

  it('should log successful join message', async () => {
    const userId = 'user-123'
    const roomId = 'room-456'

    mockEnsureAuth.mockResolvedValue(userId)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await joinRoom(roomId)

    expect(consoleSpy).toHaveBeenCalledWith(`✅ User ${userId} joined room ${roomId}`)
    consoleSpy.mockRestore()
  })

  it('should call ensureAuth to get user ID', async () => {
    mockEnsureAuth.mockResolvedValue('user-456')

    await joinRoom('room-789')

    expect(mockEnsureAuth).toHaveBeenCalledOnce()
  })
})

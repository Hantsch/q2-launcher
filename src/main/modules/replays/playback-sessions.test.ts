import { describe, expect, it } from 'vitest'
import { createPlaybackSessions } from './playback-sessions'

describe('playback sessions (story 157)', () => {
  it('isPlaying is false initially, true after begin, false after end', () => {
    const sessions = createPlaybackSessions()
    expect(sessions.isPlaying('a')).toBe(false)

    sessions.begin('a')
    expect(sessions.isPlaying('a')).toBe(true)

    sessions.end('a')
    expect(sessions.isPlaying('a')).toBe(false)
  })

  it('independent ids do not interfere with each other', () => {
    const sessions = createPlaybackSessions()
    sessions.begin('a')
    sessions.begin('b')

    expect(sessions.isPlaying('a')).toBe(true)
    expect(sessions.isPlaying('b')).toBe(true)

    sessions.end('a')
    expect(sessions.isPlaying('a')).toBe(false)
    expect(sessions.isPlaying('b')).toBe(true)
  })
})

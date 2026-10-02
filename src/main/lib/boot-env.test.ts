import { describe, expect, it } from 'vitest'
import { bootEnv } from './boot-env'

describe('bootEnv', () => {
  it('the boot env carries no Q2L_ keys and is frozen', () => {
    const source = {
      PATH: '/bin',
      Q2L_UI_HARNESS: '1',
      Q2L_UNLOCK_PUBLIC_KEY_FILE: 'k',
      HOME: '/h',
    }
    const env = bootEnv(source)

    expect(env).toEqual({ PATH: '/bin', HOME: '/h' })
    expect(Object.isFrozen(env)).toBe(true)
    expect(source.Q2L_UI_HARNESS).toBe('1')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { stubPlatform } from '../../test-support/platform'
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

  describe('lookup casing follows the platform', () => {
    let restore: (() => void) | undefined
    afterEach(() => restore?.())

    it('on win32 ProgramFiles resolves when only PROGRAMFILES is set', () => {
      restore = stubPlatform('win32')
      const env = bootEnv({ PROGRAMFILES: 'C:/PF', Q2L_UI_HARNESS: '1' })

      expect(env['ProgramFiles']).toBe('C:/PF')
      expect('programfiles' in env).toBe(true)
      expect(env['Missing']).toBeUndefined()
      expect(env['q2l_ui_harness']).toBeUndefined()
      expect(Object.isFrozen(env)).toBe(true)
    })

    it('on win32 an exact key wins over a differently cased one', () => {
      restore = stubPlatform('win32')
      const env = bootEnv({ Path: 'a', PATH: 'b' })

      expect(env['PATH']).toBe('b')
      expect(env['Path']).toBe('a')
    })

    it('on linux case is significant', () => {
      restore = stubPlatform('linux')
      const env = bootEnv({ PROGRAMFILES: 'x' })

      expect(env['ProgramFiles']).toBeUndefined()
      expect('ProgramFiles' in env).toBe(false)
      expect(env['PROGRAMFILES']).toBe('x')
    })
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { stubPlatform } from '../../test-support/platform'
import {
  executableFileName,
  foldPathCase,
  isCaseInsensitiveFs,
  isLinux,
  isWindows,
} from './platform'

describe('platform', () => {
  let restore: (() => void) | undefined
  afterEach(() => restore?.())

  it('answers every platform question for win32, linux and darwin', () => {
    const table = [
      { platform: 'win32', win: true, linux: false, ci: true, fold: 'c:/foo', exe: 'q2.exe' },
      { platform: 'linux', win: false, linux: true, ci: false, fold: 'C:/Foo', exe: 'q2' },
      { platform: 'darwin', win: false, linux: false, ci: true, fold: 'c:/foo', exe: 'q2' },
    ] as const
    for (const row of table) {
      restore = stubPlatform(row.platform)
      expect(isWindows(), row.platform).toBe(row.win)
      expect(isLinux(), row.platform).toBe(row.linux)
      expect(isCaseInsensitiveFs(), row.platform).toBe(row.ci)
      expect(foldPathCase('C:/Foo'), row.platform).toBe(row.fold)
      expect(executableFileName('q2'), row.platform).toBe(row.exe)
      expect(executableFileName('q2', 'q2-bin'), row.platform).toBe(row.win ? 'q2.exe' : 'q2-bin')
      restore()
      restore = undefined
    }
  })
})

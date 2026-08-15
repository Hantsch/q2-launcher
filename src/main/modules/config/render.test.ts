import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import {
  OWNERSHIP_MARKER,
  profileFileName,
  renderLoaderFile,
  renderProfileFile,
  sentinelLine,
} from './render'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'test-id',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('renderProfileFile', () => {
  it('renders the sentinel line followed by sorted cvars then sorted binds', () => {
    const p = profile({
      id: 'abc123',
      cvars: { sensitivity: '3', cl_run: '0', crosshair: '0' },
      binds: { UPARROW: '+forward', c: '+movedown', SHIFT: '+speed' },
    })

    expect(renderProfileFile(p)).toBe(
      [
        '// q2-launcher profile abc123 - generated, do not edit',
        'set cl_run "0"',
        'set crosshair "0"',
        'set sensitivity "3"',
        'bind SHIFT "+speed"',
        'bind UPARROW "+forward"',
        'bind c "+movedown"',
        '',
      ].join('\n'),
    )
  })

  it('emits just the sentinel line and trailing newline for an empty profile', () => {
    const p = profile({ id: 'empty-id', cvars: {}, binds: {} })

    expect(renderProfileFile(p)).toBe('// q2-launcher profile empty-id - generated, do not edit\n')
  })

  it('round-trips high-ASCII values through latin1 byte-for-byte', () => {
    const p = profile({
      id: 'hi-ascii',
      cvars: { name: 'Bjørn' },
      binds: {},
    })

    const rendered = renderProfileFile(p)
    const roundTripped = Buffer.from(rendered, 'latin1').toString('latin1')

    expect(roundTripped).toBe(rendered)
  })
})

describe('renderLoaderFile', () => {
  it('renders the sentinel line followed by the exec line', () => {
    const p = profile({ id: 'abc123' })

    expect(renderLoaderFile(p)).toBe(
      ['// q2-launcher profile abc123 - generated, do not edit', 'exec q2l-profile-abc123.cfg', ''].join(
        '\n',
      ),
    )
  })
})

describe('profileFileName', () => {
  it('produces q2l-profile-<id>.cfg', () => {
    expect(profileFileName('abc123')).toBe('q2l-profile-abc123.cfg')
  })
})

describe('sentinelLine', () => {
  it('produces the exact sentinel format', () => {
    expect(sentinelLine('abc123')).toBe('// q2-launcher profile abc123 - generated, do not edit')
  })

  it('is prefixed by OWNERSHIP_MARKER', () => {
    expect(sentinelLine('abc123').startsWith(OWNERSHIP_MARKER)).toBe(true)
  })
})

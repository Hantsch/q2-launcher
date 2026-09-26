import { describe, expect, it, vi } from 'vitest'
import { deriveLauncherInstallId, resolveLauncherInstallId } from './launcher-install-id'

const SAMPLE_GUID = '4c4c4544-0044-3510-8035-b3c04f503432'

describe('deriveLauncherInstallId', () => {
  it('the derived id is 12 base32 characters', () => {
    const id = deriveLauncherInstallId(SAMPLE_GUID)
    expect(id).toMatch(/^[A-Z2-7]{12}$/)
  })

  it('is deterministic', () => {
    expect(deriveLauncherInstallId(SAMPLE_GUID)).toBe(deriveLauncherInstallId(SAMPLE_GUID))
  })

  it('a different input produces a different output', () => {
    expect(deriveLauncherInstallId(SAMPLE_GUID)).not.toBe(deriveLauncherInstallId('other-guid-value'))
  })
})

describe('resolveLauncherInstallId', () => {
  it('win32: calls readRegistry with the right hive/key and returns the derived id', async () => {
    const readRegistry = vi.fn().mockResolvedValue(SAMPLE_GUID)
    const readFile = vi.fn()

    const id = await resolveLauncherInstallId({ platform: 'win32', readRegistry, readFile })

    expect(readRegistry).toHaveBeenCalledWith('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid')
    expect(readFile).not.toHaveBeenCalled()
    expect(id).toBe(deriveLauncherInstallId(SAMPLE_GUID))
  })

  it('linux: reads /etc/machine-id', async () => {
    const readFile = vi.fn().mockResolvedValue('abc123machineid\n')
    const readRegistry = vi.fn()

    const id = await resolveLauncherInstallId({ platform: 'linux', readRegistry, readFile })

    expect(readFile).toHaveBeenCalledWith('/etc/machine-id')
    expect(readRegistry).not.toHaveBeenCalled()
    expect(id).toBe(deriveLauncherInstallId('abc123machineid\n'))
  })

  it('linux: falls back to /var/lib/dbus/machine-id when /etc/machine-id fails', async () => {
    const readFile = vi.fn(async (path: string) => {
      if (path === '/etc/machine-id') throw new Error('boom')
      return 'dbus-machine-id-value'
    })

    const id = await resolveLauncherInstallId({ platform: 'linux', readFile })

    expect(readFile).toHaveBeenCalledWith('/etc/machine-id')
    expect(readFile).toHaveBeenCalledWith('/var/lib/dbus/machine-id')
    expect(id).toBe(deriveLauncherInstallId('dbus-machine-id-value'))
  })

  it('linux: falls back when /etc/machine-id is empty', async () => {
    const readFile = vi.fn(async (path: string) => {
      if (path === '/etc/machine-id') return '   \n'
      return 'dbus-machine-id-value'
    })

    const id = await resolveLauncherInstallId({ platform: 'linux', readFile })

    expect(id).toBe(deriveLauncherInstallId('dbus-machine-id-value'))
  })

  it('an unsupported platform returns null', async () => {
    const readRegistry = vi.fn()
    const readFile = vi.fn()

    const id = await resolveLauncherInstallId({ platform: 'darwin', readRegistry, readFile })

    expect(id).toBeNull()
    expect(readRegistry).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('an empty MachineGuid returns null', async () => {
    const readRegistry = vi.fn().mockResolvedValue('   ')

    const id = await resolveLauncherInstallId({ platform: 'win32', readRegistry, readFile: vi.fn() })

    expect(id).toBeNull()
  })

  it('a null MachineGuid returns null', async () => {
    const readRegistry = vi.fn().mockResolvedValue(null)

    const id = await resolveLauncherInstallId({ platform: 'win32', readRegistry, readFile: vi.fn() })

    expect(id).toBeNull()
  })

  it('both linux machine-id reads failing returns null', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('enoent'))

    const id = await resolveLauncherInstallId({ platform: 'linux', readFile })

    expect(id).toBeNull()
  })
})

describe('the raw machine value is never returned or logged', () => {
  const RAW_SECRET = 'super-secret-raw-machine-guid-4c4c4544'

  it('is never present in the resolved id, and no console output happens on success', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ]

    const readRegistry = vi.fn().mockResolvedValue(RAW_SECRET)
    const id = await resolveLauncherInstallId({ platform: 'win32', readRegistry, readFile: vi.fn() })

    expect(id).not.toBeNull()
    expect(id).not.toBe(RAW_SECRET)
    expect(id).not.toContain(RAW_SECRET)
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })

  it('a thrown error containing a raw-looking value never leaks past resolveLauncherInstallId', async () => {
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ]

    const readRegistry = vi.fn().mockRejectedValue(new Error(`registry read failed for ${RAW_SECRET}`))

    let thrown: unknown = null
    let id: string | null = 'unset'
    try {
      id = await resolveLauncherInstallId({ platform: 'win32', readRegistry, readFile: vi.fn() })
    } catch (err) {
      thrown = err
    }

    // Must not rethrow, must resolve to null, and nothing must have logged the secret.
    expect(thrown).toBeNull()
    expect(id).toBeNull()
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(RAW_SECRET)
        }
      }
      spy.mockRestore()
    }
  })
})

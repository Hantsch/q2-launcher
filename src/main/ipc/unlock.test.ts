import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnlockPayload } from '@shared/unlock'
import type { AppContext } from '../context'
import type { UnlockState as StoredUnlockState } from '../lib/schemas'
import { resolveFeatureGate } from '../features/gate'
import { encodeUnlockPayload } from '../services/unlock/code'
import {
  harnessUnlockPublicKeyOverride,
  UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV,
  UNLOCK_PUBLIC_KEY_PEM,
} from '../services/unlock/public-key'
import { createUnlockService, type UnlockService } from '../services/unlock/service'

/**
 * Story 129 D1: `unlock:getState` / `unlock:redeem` over a real `UnlockService` (128) with a
 * throwaway Ed25519 key pair, an in-memory state and an injected clock - never the embedded
 * production key or a real machine. `electron` is mocked the same minimal way as `app.test.ts`.
 */

const registered = vi.hoisted(
  () => new Map<string, (event: unknown, payload: unknown) => unknown>(),
)

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      registered.set(channel, fn)
    }),
  },
  app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => 'C:\\fake\\userData' },
  BrowserWindow: { fromWebContents: () => null },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  clipboard: { writeText: vi.fn() },
}))

const fakeEvent = {} as unknown as IpcMainInvokeEvent

const issuer = generateKeyPairSync('ed25519')
const foreign = generateKeyPairSync('ed25519')
const issuerPublicPem = issuer.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const issuerPublicBase64 = issuer.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

const INSTALL_ID = 'ABCDEFGHJKLM'
const NOW = new Date('2026-06-01T00:00:00.000Z')
const NOW_S = Math.floor(NOW.getTime() / 1000)

function issueCode(payload: Partial<UnlockPayload> = {}, key: KeyObject = issuer.privateKey): string {
  const unsigned = encodeUnlockPayload({
    features: ['pro-servers'],
    launcherInstallId: INSTALL_ID,
    issuedAt: NOW_S - 10,
    redeemBy: NOW_S + 1000,
    ...payload,
  })
  const signature = cryptoSign(null, Buffer.from(unsigned, 'ascii'), key)
  return `${unsigned}.${signature.toString('base64url')}`
}

function memoryState(initial: StoredUnlockState = { codes: [] }): {
  unlockState(): StoredUnlockState
  setUnlockState(next: StoredUnlockState): StoredUnlockState
} {
  let current = initial
  return {
    unlockState: () => current,
    setUnlockState: (next) => (current = next),
  }
}

async function startService(options: {
  state?: ReturnType<typeof memoryState>
  publicKey?: string
  now?: Date
} = {}): Promise<UnlockService> {
  const service = createUnlockService({
    state: options.state ?? memoryState(),
    publicKey: options.publicKey ?? issuerPublicPem,
    resolveLauncherInstallId: async () => INSTALL_ID,
    now: () => options.now ?? NOW,
  })
  await service.init()
  return service
}

async function setup(unlock: UnlockService): Promise<{
  getState: (event: unknown, payload: unknown) => unknown
  redeem: (event: unknown, payload: unknown) => unknown
}> {
  const { registerUnlockIpc } = await import('./unlock')
  registerUnlockIpc({ unlock } as unknown as AppContext)
  return {
    getState: registered.get('unlock:getState')!,
    redeem: registered.get('unlock:redeem')!,
  }
}

const ORIGINAL_HARNESS_ENV = process.env.Q2L_UI_HARNESS
const ORIGINAL_KEY_ENV = process.env[UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV]

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  registered.clear()
  vi.resetModules()
  delete process.env.Q2L_UI_HARNESS
  delete process.env[UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV]
})

afterEach(() => {
  restoreEnv('Q2L_UI_HARNESS', ORIGINAL_HARNESS_ENV)
  restoreEnv(UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV, ORIGINAL_KEY_ENV)
})

describe('unlock:redeem', () => {
  it('each rejection path maps to its own reason', async () => {
    const { redeem } = await setup(await startService())

    const cases: Array<[string, string]> = [
      ['not a code at all', 'not-a-code'],
      [issueCode({}, foreign.privateKey), 'bad-signature'],
      [issueCode({ launcherInstallId: 'ZZZZZZZZZZZZ' }), 'wrong-installation'],
      [issueCode({ redeemBy: NOW_S - 1 }), 'redeem-window-elapsed'],
      [issueCode({ expiresAt: NOW_S - 1 }), 'feature-expired'],
    ]

    const reasons: string[] = []
    for (const [code, reason] of cases) {
      const result = await redeem(fakeEvent, code)
      expect(result).toEqual({ ok: true, value: { ok: false, reason } })
      reasons.push(reason)
    }
    expect(new Set(reasons).size).toBe(cases.length)
  })

  it('a valid code resolves with its features, expiry and label', async () => {
    const service = await startService()
    const { redeem, getState } = await setup(service)
    const expiresAt = NOW_S + 86_400
    const code = issueCode({ features: ['pro-servers', 'beta-feed'], expiresAt, label: 'Beta tester' })

    const result = await redeem(fakeEvent, `  ${code}\n`)

    const expected = {
      features: ['pro-servers', 'beta-feed'],
      featureExpiry: expiresAt * 1000,
      label: 'Beta tester',
      status: 'active',
    }
    expect(result).toEqual({ ok: true, value: { ok: true, code: expected } })
    expect(await getState(fakeEvent, undefined)).toEqual({
      installationId: 'ABCD-EFGH-JKLM',
      codes: [expected],
    })
  })

  it('an expired stored code is reported expired and its feature is no longer unlocked', async () => {
    const expiresAt = NOW_S + 60
    const state = memoryState()
    const first = await startService({ state })
    const firstIpc = await setup(first)
    const code = issueCode({ expiresAt, label: 'Trial' })
    expect(await firstIpc.redeem(fakeEvent, code)).toMatchObject({ ok: true, value: { ok: true } })

    // Simulated start after the feature expiry has passed.
    registered.clear()
    vi.resetModules()
    const restarted = await startService({ state, now: new Date((expiresAt + 1) * 1000) })
    const { getState } = await setup(restarted)

    expect(await getState(fakeEvent, undefined)).toEqual({
      installationId: 'ABCD-EFGH-JKLM',
      codes: [
        { features: ['pro-servers'], featureExpiry: expiresAt * 1000, label: 'Trial', status: 'expired' },
      ],
    })
    const gate = resolveFeatureGate(restarted)
    expect(gate.unlockedFeatures()).not.toContain('pro-servers')
    expect(restarted.isUnlocked('pro-servers')).toBe(false)
    // Kept, not deleted: the record is still in storage.
    expect(state.unlockState().codes.map((entry) => entry.code)).toEqual([code])
  })

  it('re-redeeming a stored code does not duplicate it', async () => {
    const state = memoryState()
    const first = await startService({ state })
    const firstIpc = await setup(first)
    const code = issueCode({ redeemBy: NOW_S + 60 })

    const once = await firstIpc.redeem(fakeEvent, code)
    const twice = await firstIpc.redeem(fakeEvent, ` ${code} `)
    expect(twice).toEqual(once)
    const storedRow = state.unlockState().codes[0]

    // Even once its redemption window has closed, the stored code is still an idempotent success.
    registered.clear()
    vi.resetModules()
    const later = await startService({ state, now: new Date((NOW_S + 3600) * 1000) })
    const { redeem } = await setup(later)
    expect(await redeem(fakeEvent, code)).toEqual(once)

    expect(state.unlockState().codes).toEqual([storedRow])
  })

  it('the test public key is ignored outside the harness double gate', async () => {
    process.env[UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV] = issuerPublicBase64
    const code = issueCode()

    const gates: Array<{ harness?: string; isDev: boolean; accepted: boolean }> = [
      { isDev: false, accepted: false },
      { harness: '1', isDev: false, accepted: false },
      { isDev: true, accepted: false },
      { harness: 'true', isDev: true, accepted: false },
      { harness: '1', isDev: true, accepted: true },
    ]

    for (const gate of gates) {
      restoreEnv('Q2L_UI_HARNESS', gate.harness)
      const override = harnessUnlockPublicKeyOverride({ isDev: gate.isDev })
      expect(override === null).toBe(!gate.accepted)

      registered.clear()
      vi.resetModules()
      const { redeem } = await setup(await startService({ publicKey: override ?? UNLOCK_PUBLIC_KEY_PEM }))
      const result = await redeem(fakeEvent, code)
      expect(result).toEqual(
        gate.accepted
          ? { ok: true, value: { ok: true, code: expect.objectContaining({ features: ['pro-servers'] }) } }
          : { ok: true, value: { ok: false, reason: 'bad-signature' } },
      )
    }
  })

  it('a non-string or over-length payload is refused before the service is called', async () => {
    const service = await startService()
    const redeemSpy = vi.spyOn(service, 'redeem')
    const { redeem } = await setup(service)

    for (const payload of [42, { code: 'q2l1.x.y' }, null, undefined, '   ', 'x'.repeat(4097)]) {
      expect(await redeem(fakeEvent, payload)).toEqual({
        ok: false,
        error: { key: 'ipc.error.invalidPayload' },
      })
    }
    expect(redeemSpy).not.toHaveBeenCalled()
  })
})

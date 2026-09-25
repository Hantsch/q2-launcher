import { generateKeyPairSync, randomUUID, sign as cryptoSign } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UnlockPayload } from '@shared/unlock'
import { StateStore } from '../state'
import { createUnlockService, type UnlockServiceLog } from './service'
import { encodeUnlockPayload } from './code'
import { deriveLauncherInstallId } from './launcher-install-id'

/**
 * Story 128 D4: `UnlockService` over a real `StateStore` (same in-memory-file-over-temp-path
 * convention as `state.test.ts`), a throwaway Ed25519 key pair and an injected clock - never the
 * embedded production key or a real machine.
 */

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function issueCode(payload: UnlockPayload): string {
  const unsigned = encodeUnlockPayload(payload)
  const signature = cryptoSign(null, Buffer.from(unsigned, 'ascii'), privateKey)
  return `${unsigned}.${signature.toString('base64url')}`
}

const LAUNCHER_INSTALL_ID = 'ABCDEFGHJKLM'

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function spyLog(): UnlockServiceLog & { messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    warn: (message: string) => messages.push(message),
    error: (message: string) => messages.push(message),
  }
}

describe('UnlockService (story 128 D4)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-unlock-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('redeeming a valid code unlocks its features and persists it (AC1)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => now,
    })
    await service.init()

    const code = issueCode({
      features: ['pro-servers'],
      launcherInstallId: LAUNCHER_INSTALL_ID,
      issuedAt: seconds(now) - 10,
      redeemBy: seconds(now) + 1000,
    })

    const verdict = service.redeem(code)
    await state.settle()

    expect(verdict).toEqual({ ok: true, features: ['pro-servers'] })
    expect(service.isUnlocked('pro-servers')).toBe(true)
    expect(state.unlockState().codes).toHaveLength(1)
    expect(state.unlockState().codes[0].code).toBe(code)
  })

  it('a redeemed code stays unlocked after its redemption window has closed (AC4)', async () => {
    const redeemedAt = new Date('2026-01-01T00:00:00.000Z')
    let current = redeemedAt
    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => current,
    })
    await service.init()

    const code = issueCode({
      features: ['pro-servers'],
      launcherInstallId: LAUNCHER_INSTALL_ID,
      issuedAt: seconds(redeemedAt) - 10,
      redeemBy: seconds(redeemedAt) + 60, // window closes soon after redemption
    })

    expect(service.redeem(code)).toEqual({ ok: true, features: ['pro-servers'] })
    await state.settle()

    // Advance the clock well past redeemBy and simulate an app restart via a fresh service instance.
    current = new Date(redeemedAt.getTime() + 365 * 24 * 60 * 60 * 1000)
    const restarted = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => current,
    })
    await restarted.init()

    expect(restarted.isUnlocked('pro-servers')).toBe(true)
    expect(restarted.snapshot().codes[0].status).toBe('active')
  })

  it('init re-verifies every stored code without any user action (AC5)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const code = issueCode({
      features: ['pro-servers'],
      launcherInstallId: LAUNCHER_INSTALL_ID,
      issuedAt: seconds(now) - 10,
      redeemBy: seconds(now) + 1000,
    })
    state.setUnlockState({ codes: [{ code, redeemedAt: now.toISOString() }] })

    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => now,
    })

    expect(service.isUnlocked('pro-servers')).toBe(false) // not yet initialised
    await service.init()
    expect(service.isUnlocked('pro-servers')).toBe(true)
  })

  it('persisted unlock state and logs never contain the raw machine value (AC6)', async () => {
    const RAW_MACHINE_VALUE = 'RAW-MACHINE-GUID-DO-NOT-LEAK-7f3a9c'
    const now = new Date('2026-01-01T00:00:00.000Z')
    const log = spyLog()

    // A fake resolver that actually computes its returned id FROM the raw-looking secret, the same
    // way the real `resolveLauncherInstallId` derives from a real MachineGuid/machine-id via
    // `deriveLauncherInstallId`. Unlike a resolver that merely declares-and-discards the raw value,
    // this one's return value is causally dependent on it, so if `UnlockService` ever logged or
    // persisted something derived from the resolver's internals (not just its opaque return value),
    // a regression has a real chance of surfacing the raw string for the assertions below to catch.
    const derivedInstallId = deriveLauncherInstallId(RAW_MACHINE_VALUE)
    async function fakeResolve(): Promise<string | null> {
      return deriveLauncherInstallId(RAW_MACHINE_VALUE)
    }

    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: fakeResolve,
      now: () => now,
      log,
    })
    await service.init()

    const code = issueCode({
      features: ['pro-servers'],
      launcherInstallId: derivedInstallId,
      issuedAt: seconds(now) - 10,
      redeemBy: seconds(now) + 1000,
    })
    service.redeem(code)
    await state.settle()
    service.snapshot()

    // Also exercise a rejection log path (service.ts logs the rejection reason on redeem), and a
    // second init()/reverify pass, so more of the service's own log call sites - not just the happy
    // path - are checked for a leak.
    const badCode = issueCode({
      features: ['pro-servers'],
      launcherInstallId: 'ZZZZZZZZZZZZ',
      issuedAt: seconds(now) - 10,
      redeemBy: seconds(now) + 1000,
    })
    service.redeem(badCode)

    const restarted = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: fakeResolve,
      now: () => now,
      log,
    })
    await restarted.init()
    restarted.snapshot()

    const persisted = JSON.stringify(state.unlockState())
    expect(persisted).not.toContain(RAW_MACHINE_VALUE)
    for (const message of log.messages) {
      expect(message).not.toContain(RAW_MACHINE_VALUE)
    }
  })

  it('a stored code whose feature expiry has passed no longer unlocks at init (AC7)', async () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    const code = issueCode({
      features: ['pro-servers'],
      launcherInstallId: LAUNCHER_INSTALL_ID,
      issuedAt: seconds(now) - 20_000,
      redeemBy: seconds(now) - 10_000,
      expiresAt: seconds(now) - 1_000, // already expired relative to `now`
    })
    state.setUnlockState({ codes: [{ code, redeemedAt: new Date(now.getTime() - 20_000_000).toISOString() }] })

    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => now,
    })
    await service.init()

    expect(service.isUnlocked('pro-servers')).toBe(false)
    const snapshot = service.snapshot()
    expect(snapshot.codes).toHaveLength(1)
    expect(snapshot.codes[0].status).toBe('featureExpired')
  })

  it('redeeming a 33rd distinct code drops the oldest-redeemed one, keeping at most 32 (bug: unbounded growth)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => now,
    })
    await service.init()

    const codes = Array.from({ length: 33 }, (_, index) =>
      issueCode({
        features: ['pro-servers'],
        launcherInstallId: LAUNCHER_INSTALL_ID,
        issuedAt: seconds(now) - 10,
        redeemBy: seconds(now) + 1000 + index, // distinct payload per code, and later ones redeem later
      }),
    )

    for (const code of codes) {
      expect(service.redeem(code)).toEqual({ ok: true, features: ['pro-servers'] })
    }
    await state.settle()

    const stored = state.unlockState().codes
    expect(stored.length).toBeLessThanOrEqual(32)
    expect(stored.some((entry) => entry.code === codes[0])).toBe(false)
    expect(stored.some((entry) => entry.code === codes[32])).toBe(true)
  })

  it('redeeming the same code with and without surrounding whitespace stores only one entry (bug: untrimmed dedupe key)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => now,
    })
    await service.init()

    const code = issueCode({
      features: ['pro-servers'],
      launcherInstallId: LAUNCHER_INSTALL_ID,
      issuedAt: seconds(now) - 10,
      redeemBy: seconds(now) + 1000,
    })

    expect(service.redeem(code)).toEqual({ ok: true, features: ['pro-servers'] })
    expect(service.redeem(`  ${code}\n`)).toEqual({ ok: true, features: ['pro-servers'] })
    await state.settle()

    expect(state.unlockState().codes).toHaveLength(1)
    expect(state.unlockState().codes[0].code).toBe(code)
  })
})

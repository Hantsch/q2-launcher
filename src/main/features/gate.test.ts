import { generateKeyPairSync, randomUUID, sign as cryptoSign } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UnlockPayload } from '@shared/unlock'
import { StateStore } from '../services/state'
import { createUnlockService } from '../services/unlock/service'
import { encodeUnlockPayload } from '../services/unlock/code'
import { createFeatureGate, LOCKED_FEATURE_GATE, resolveFeatureGate } from './gate'

/**
 * Story 130 D1: the feature gate is derived from 128's already-verified `UnlockService` state and
 * nothing else, and it is a frozen copy of that state.
 */
describe('resolveFeatureGate', () => {
  it('unlocks exactly what the unlock service reports as unlocked', () => {
    const gate = resolveFeatureGate({ unlockedFeatures: () => new Set(['test-only-feature']) })

    expect(gate.isFeatureUnlocked('test-only-feature')).toBe(true)
    expect(gate.isFeatureUnlocked('some-other-feature')).toBe(false)
    expect(gate.unlockedFeatures()).toEqual(['test-only-feature'])
  })

  it('unlocks nothing when the unlock service reports nothing', () => {
    const gate = resolveFeatureGate({ unlockedFeatures: () => new Set() })

    expect(gate.isFeatureUnlocked('test-only-feature')).toBe(false)
    expect(gate.unlockedFeatures()).toEqual([])
  })
})

describe('createFeatureGate', () => {
  it('does not alias a source Set', () => {
    const source = new Set(['test-only-feature'])
    const gate = createFeatureGate(source)

    source.add('added-later')
    source.delete('test-only-feature')

    expect(gate.isFeatureUnlocked('test-only-feature')).toBe(true)
    expect(gate.isFeatureUnlocked('added-later')).toBe(false)
    expect(gate.unlockedFeatures()).toEqual(['test-only-feature'])
  })

  it('does not alias a source array, nor hand out its own set', () => {
    const source = ['test-only-feature']
    const gate = createFeatureGate(source)

    source.push('added-later')
    gate.unlockedFeatures().push('pushed-into-result')

    expect(gate.isFeatureUnlocked('added-later')).toBe(false)
    expect(gate.isFeatureUnlocked('pushed-into-result')).toBe(false)
    expect(gate.unlockedFeatures()).toEqual(['test-only-feature'])
  })
})

describe('LOCKED_FEATURE_GATE', () => {
  it('unlocks nothing', () => {
    expect(LOCKED_FEATURE_GATE.isFeatureUnlocked('test-only-feature')).toBe(false)
    expect(LOCKED_FEATURE_GATE.unlockedFeatures()).toEqual([])
  })
})

/**
 * Story 130 D1 AC3: the gate must be exercised end-to-end over a real `UnlockService` (story 128),
 * with a real signed code verified by the real Ed25519 verifier - not just the hand-built stub
 * above - so a break in the real verification path would actually be caught here.
 */
describe('resolveFeatureGate (end-to-end with a real UnlockService)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const { privateKey: otherPrivateKey } = generateKeyPairSync('ed25519')

  const LAUNCHER_INSTALL_ID = 'ABCDEFGHJKLM'

  function issueCode(payload: UnlockPayload, signingKey = privateKey): string {
    const unsigned = encodeUnlockPayload(payload)
    const signature = cryptoSign(null, Buffer.from(unsigned, 'ascii'), signingKey)
    return `${unsigned}.${signature.toString('base64url')}`
  }

  function seconds(date: Date): number {
    return Math.floor(date.getTime() / 1000)
  }

  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-gate-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('only a token main\'s verifier accepts unlocks a feature', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => now,
    })
    await service.init()

    const code = issueCode({
      features: ['test-only-feature'],
      launcherInstallId: LAUNCHER_INSTALL_ID,
      issuedAt: seconds(now) - 10,
      redeemBy: seconds(now) + 1000,
    })

    expect(service.redeem(code)).toEqual({ ok: true, features: ['test-only-feature'] })

    const gate = resolveFeatureGate(service)

    expect(gate.isFeatureUnlocked('test-only-feature')).toBe(true)
    expect(gate.unlockedFeatures()).toContain('test-only-feature')
  })

  it('a code signed by a different key unlocks nothing', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const service = createUnlockService({
      state,
      publicKey: publicKeyPem,
      resolveLauncherInstallId: async () => LAUNCHER_INSTALL_ID,
      now: () => now,
    })
    await service.init()

    const code = issueCode(
      {
        features: ['test-only-feature'],
        launcherInstallId: LAUNCHER_INSTALL_ID,
        issuedAt: seconds(now) - 10,
        redeemBy: seconds(now) + 1000,
      },
      otherPrivateKey,
    )

    expect(service.redeem(code).ok).toBe(false)

    const gate = resolveFeatureGate(service)

    expect(gate.isFeatureUnlocked('test-only-feature')).toBe(false)
    expect(gate.unlockedFeatures()).toEqual([])
  })
})

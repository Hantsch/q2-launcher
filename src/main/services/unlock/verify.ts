import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import type { UnlockPayload, UnlockRejected } from '@shared/unlock'
import { parseUnlockCode } from './code'

/**
 * Verifies an unlock code (story 128). Pure: the key, the current installation
 * id and the clock are all passed in, and nothing here throws.
 *
 * The checks run cheapest-first and the first failure wins:
 *
 *  1. format        -> `malformed` (before any signature work)
 *  2. signature     -> `badSignature`, Ed25519 over the exact signed bytes; a
 *                      thrown `crypto` error (unusable or non-Ed25519 key) is a
 *                      bad signature too, never an exception
 *  3. installation  -> `wrongInstallation`, also when this machine has no id
 *  4. redeem-by     -> `redemptionWindowElapsed`, **redeem mode only**: the
 *                      window governs entering a code, not keeping it, so
 *                      `reverify` never looks at `redeemBy`
 *  5. feature expiry-> `featureExpired`, in both modes
 *
 * Time comparisons are written so an invalid `now` (NaN) fails closed.
 */

export type UnlockVerifyMode = 'redeem' | 'reverify'

export interface VerifyUnlockOptions {
  publicKey: KeyObject | string
  launcherInstallId: string | null
  now: Date
  mode: UnlockVerifyMode
}

export type UnlockVerification = { ok: true; payload: UnlockPayload } | UnlockRejected

function signatureIsValid(signedBytes: Buffer, signature: Buffer, publicKey: KeyObject | string): boolean {
  try {
    // `createPublicKey` rejects a KeyObject that is already public.
    const key = typeof publicKey !== 'string' && publicKey.type === 'public' ? publicKey : createPublicKey(publicKey)
    // `verify(null, ...)` picks the algorithm from the key type, so a key of any
    // other type would verify under its own rules. Only Ed25519 is accepted.
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, signedBytes, key, signature)
  } catch {
    return false
  }
}

export function verifyUnlockCode(code: string, options: VerifyUnlockOptions): UnlockVerification {
  const { publicKey, launcherInstallId, now, mode } = options

  const parsed = parseUnlockCode(code)
  if (!parsed.ok) return { ok: false, reason: 'malformed' }
  const { payload, signedBytes, signature } = parsed

  if (!signatureIsValid(signedBytes, signature, publicKey)) return { ok: false, reason: 'badSignature' }

  if (launcherInstallId === null || launcherInstallId !== payload.launcherInstallId) {
    return { ok: false, reason: 'wrongInstallation' }
  }

  const nowSeconds = now.getTime() / 1000

  if (mode === 'redeem' && !(nowSeconds <= payload.redeemBy)) {
    return { ok: false, reason: 'redemptionWindowElapsed' }
  }

  if (payload.expiresAt !== undefined && !(nowSeconds < payload.expiresAt)) {
    return { ok: false, reason: 'featureExpired' }
  }

  return { ok: true, payload }
}

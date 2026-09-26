/**
 * Unlock codes (story 128): the shared vocabulary for codes, verdicts and the
 * launcher's installation id.
 *
 * Node-free and zod-free on purpose - this file is reachable from the sandboxed
 * preload bundle. Parsing and signature verification live main-side in
 * `src/main/services/unlock/`.
 *
 * A code is `q2l1.<payloadB64>.<sigB64>`: an Ed25519 signature over the exact
 * ASCII bytes `q2l1.<payloadB64>`, both segments strict base64url without padding.
 */

export const UNLOCK_CODE_PREFIX = 'q2l1'

export const UNLOCK_REJECTIONS = [
  'malformed',
  'badSignature',
  'wrongInstallation',
  'redemptionWindowElapsed',
  'featureExpired',
] as const

export type UnlockRejection = (typeof UNLOCK_REJECTIONS)[number]

/** A feature name: lowercase, starts with a letter, at most 32 characters. */
export const FEATURE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

/** A launcher installation id: 12 base32 (RFC 4648) characters, stored ungrouped. */
export const LAUNCHER_INSTALL_ID_PATTERN = /^[A-Z2-7]{12}$/

/** The signed content of a code. Timestamps are integer epoch seconds. */
export interface UnlockPayload {
  features: string[]
  launcherInstallId: string
  issuedAt: number
  redeemBy: number
  expiresAt?: number
  label?: string
}

/** A rejection, shared by the verifier and the redeem verdict. */
export interface UnlockRejected {
  ok: false
  reason: UnlockRejection
}

/**
 * The result of redeeming a code. `label`/`expiresAt` (epoch seconds) are present only when the
 * code itself carries them.
 */
export type UnlockVerdict =
  | { ok: true; features: string[]; label?: string; expiresAt?: number }
  | UnlockRejected

export interface UnlockSnapshot {
  launcherInstallId: string | null
  codes: Array<{
    features: string[]
    label?: string
    expiresAt?: number
    redeemedAt: string
    status: 'active' | UnlockRejection
  }>
}

/** Shows a 12-character id as `XXXX-XXXX-XXXX`. */
export function formatLauncherInstallId(id: string): string {
  return (id.match(/.{1,4}/g) ?? []).join('-')
}

/**
 * Accepts an id the way a person types or pastes it - any case, grouped with
 * hyphens, with stray whitespace - and returns the canonical ungrouped form,
 * or `null` when it is not a valid id.
 */
export function normalizeLauncherInstallId(input: string): string | null {
  const stripped = input.replace(/[\s-]/g, '')
  // Validate before uppercasing: `toUpperCase` maps some non-ASCII letters onto
  // ASCII ones (`ß` -> `SS`), which must not turn garbage into a valid id.
  if (!/^[A-Za-z2-7]{12}$/.test(stripped)) return null
  const id = stripped.toUpperCase()
  return LAUNCHER_INSTALL_ID_PATTERN.test(id) ? id : null
}

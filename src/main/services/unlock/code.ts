import { z } from 'zod'
import {
  FEATURE_NAME_PATTERN,
  LAUNCHER_INSTALL_ID_PATTERN,
  UNLOCK_CODE_PREFIX,
  type UnlockPayload,
} from '@shared/unlock'

/**
 * Parses the unlock-code format `q2l1.<payloadB64>.<sigB64>` (story 128).
 *
 * Pure and throw-free: every way a code can be wrong on the way to a typed
 * payload - structure, prefix, base64url, UTF-8, JSON, schema, timestamp order -
 * collapses into the same `malformed` result, so a caller never has to tell
 * them apart and nothing here can escape as an exception.
 *
 * `signedBytes` is the exact ASCII text `q2l1.<payloadB64>` taken from the input,
 * never a re-serialisation of the parsed payload: JSON re-serialisation is not
 * byte-stable (key order, whitespace, escapes), and the signature covers the
 * bytes the issuer produced, not the object they describe.
 *
 * `encodeUnlockPayload` is the issuing side of the same convention. The issuing
 * script is a plain Node script that cannot import this file, so the convention
 * is kept deliberately obvious: `JSON.stringify(payload)` as given, UTF-8,
 * base64url without padding, prefixed with `q2l1.`.
 */

/** Well above anything the issuer produces (16 x 32-char features + label); bounds work on junk input. */
const MAX_CODE_LENGTH = 4096

/** Strict base64url: alphabet only, no padding, non-empty. */
const BASE64URL = /^[A-Za-z0-9_-]+$/

const epochSeconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

const payloadSchema = z.strictObject({
  features: z.array(z.string().regex(FEATURE_NAME_PATTERN)).min(1).max(16),
  launcherInstallId: z.string().regex(LAUNCHER_INSTALL_ID_PATTERN),
  issuedAt: epochSeconds,
  redeemBy: epochSeconds,
  expiresAt: epochSeconds.optional(),
  label: z.string().min(1).max(64).optional(),
})

export type ParsedUnlockCode =
  | { ok: true; payload: UnlockPayload; signedBytes: Buffer; signature: Buffer }
  | { ok: false; reason: 'malformed' }

const MALFORMED = { ok: false, reason: 'malformed' } as const

const utf8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Decodes a strict, canonical base64url segment, or `null`. The round-trip check
 * rejects encodings Node would otherwise decode leniently (a dangling sixth-bit
 * character, non-zero trailing bits), so one byte string has exactly one spelling.
 */
function decodeBase64url(segment: string): Buffer | null {
  if (!BASE64URL.test(segment)) return null
  const bytes = Buffer.from(segment, 'base64url')
  return bytes.toString('base64url') === segment ? bytes : null
}

function parsePayload(payloadB64: string): UnlockPayload | null {
  const bytes = decodeBase64url(payloadB64)
  if (bytes === null) return null
  let json: unknown
  try {
    json = JSON.parse(utf8.decode(bytes))
  } catch {
    return null
  }
  const result = payloadSchema.safeParse(json)
  if (!result.success) return null
  const payload = result.data
  if (new Set(payload.features).size !== payload.features.length) return null
  if (payload.redeemBy < payload.issuedAt) return null
  if (payload.expiresAt !== undefined && payload.expiresAt <= payload.issuedAt) return null
  return payload
}

export function parseUnlockCode(raw: string): ParsedUnlockCode {
  if (typeof raw !== 'string' || raw.length > MAX_CODE_LENGTH) return MALFORMED
  const parts = raw.trim().split('.')
  if (parts.length !== 3) return MALFORMED
  const [prefix, payloadB64, sigB64] = parts
  if (prefix !== UNLOCK_CODE_PREFIX) return MALFORMED

  const payload = parsePayload(payloadB64)
  if (payload === null) return MALFORMED
  const signature = decodeBase64url(sigB64)
  if (signature === null) return MALFORMED

  return {
    ok: true,
    payload,
    signedBytes: Buffer.from(`${prefix}.${payloadB64}`, 'ascii'),
    signature,
  }
}

/** Returns `q2l1.<payloadB64>` - the exact string an issuer signs. */
export function encodeUnlockPayload(payload: UnlockPayload): string {
  return `${UNLOCK_CODE_PREFIX}.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`
}

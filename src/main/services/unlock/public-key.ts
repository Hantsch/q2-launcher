import { UI_HARNESS_ENV } from '../../lib/ui-harness'

/**
 * Story 128 D3: the embedded production public key for unlock-code verification.
 *
 * This is the SPKI PEM half of the Ed25519 key pair that signs real unlock codes. The matching
 * private key lives at `~/.q2-launcher/unlock-signing-key.pem` on the machine that ran
 * `node scripts/issue-unlock-code.mjs keygen` - it must never enter this repository. Generating a
 * new key pair here would invalidate every code already issued under the old one, so this constant
 * is only ever replaced deliberately, in step with a corresponding key rotation.
 */
export const UNLOCK_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiqlqXK+qBH6r4950iW2lQDKkoAnwImOsCGgF0d4QzS0=
-----END PUBLIC KEY-----
`

/** Story 129: carries a test public key into a UI-harness run (SPKI PEM, or its bare base64 body). */
export const UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV = 'Q2L_UI_UNLOCK_PUBLIC_KEY'

/**
 * Story 129: the harness-only replacement for `UNLOCK_PUBLIC_KEY_PEM`, so UI flows can redeem codes
 * signed by a throwaway key. `null` - the embedded key stays in force - unless **both**
 * `Q2L_UI_HARNESS === '1'` and `isDev`; outside that double gate the variable is not even read.
 * Stricter than the harness gate alone on purpose: a variable that can swap the trust root must not
 * be honoured by a packaged build, whoever exported it.
 */
export function harnessUnlockPublicKeyOverride(options: {
  isDev: boolean
  env?: NodeJS.ProcessEnv
}): string | null {
  const env = options.env ?? process.env
  if (!(env[UI_HARNESS_ENV] === '1' && options.isDev)) return null

  const raw = env[UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV]?.trim()
  if (!raw) return null
  if (raw.includes('-----BEGIN')) return raw
  const body = raw.replace(/\s+/g, '').match(/.{1,64}/g) ?? []
  return `-----BEGIN PUBLIC KEY-----\n${body.join('\n')}\n-----END PUBLIC KEY-----\n`
}

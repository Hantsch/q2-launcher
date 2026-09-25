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

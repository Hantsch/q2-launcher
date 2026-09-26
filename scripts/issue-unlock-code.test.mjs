import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { verifyUnlockCode } from '../src/main/services/unlock/verify.ts'
import {
  issueUnlockCode,
  loadSigningKey,
  openSshPublicKeyToPem,
  resolveSigningKeyPath,
} from './issue-unlock-code.mjs'

/**
 * Story 128 D3 - the issuing script's own contract: a code it produces has to be accepted by D1's
 * verifier, since this script's whole job is to hand real players a code that
 * `src/main/services/unlock/verify.ts` will later redeem. That round trip is what keeps this file's
 * hand-rolled re-implementation of the wire format honest against `src/shared/unlock.ts` and
 * `src/main/services/unlock/code.ts`, which it cannot import (a plain Node script cannot load `.ts`).
 */

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const INSTALL_ID = 'ABCDEFGH2345'

function throwawayKeyPair() {
  return generateKeyPairSync('ed25519')
}

describe('issueUnlockCode - round trip with verifyUnlockCode', () => {
  test('a code issued by the script is accepted by verifyUnlockCode', () => {
    const { publicKey, privateKey } = throwawayKeyPair()

    const code = issueUnlockCode({
      features: ['watchlist'],
      launcherInstallId: INSTALL_ID,
      privateKey,
    })

    const result = verifyUnlockCode(code, {
      publicKey,
      launcherInstallId: INSTALL_ID,
      now: new Date(),
      mode: 'redeem',
    })

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ ok: true, payload: { features: ['watchlist'], launcherInstallId: INSTALL_ID } })
  })

  test('accepts a grouped, lower-case install id and normalizes it in the payload', () => {
    const { publicKey, privateKey } = throwawayKeyPair()
    const grouped = 'abcd-efgh-2345'

    const code = issueUnlockCode({
      features: ['watchlist', 'spectate'],
      launcherInstallId: grouped,
      privateKey,
    })

    const result = verifyUnlockCode(code, {
      publicKey,
      launcherInstallId: INSTALL_ID,
      now: new Date(),
      mode: 'redeem',
    })

    expect(result.ok).toBe(true)
  })

  test('default redeem-by is 24 hours after issued-at', () => {
    const { publicKey, privateKey } = throwawayKeyPair()
    const now = new Date('2026-01-01T00:00:00.000Z')

    const code = issueUnlockCode({
      features: ['watchlist'],
      launcherInstallId: INSTALL_ID,
      now,
      privateKey,
    })

    const justBefore = verifyUnlockCode(code, {
      publicKey,
      launcherInstallId: INSTALL_ID,
      now: new Date(now.getTime() + 24 * 3600 * 1000 - 1000),
      mode: 'redeem',
    })
    expect(justBefore.ok).toBe(true)

    const justAfter = verifyUnlockCode(code, {
      publicKey,
      launcherInstallId: INSTALL_ID,
      now: new Date(now.getTime() + 24 * 3600 * 1000 + 1000),
      mode: 'redeem',
    })
    expect(justAfter).toEqual({ ok: false, reason: 'redemptionWindowElapsed' })
  })

  test('an expiresAt in the payload is enforced by verifyUnlockCode as featureExpired', () => {
    const { publicKey, privateKey } = throwawayKeyPair()
    const now = new Date('2026-01-01T00:00:00.000Z')
    // Before the default 24h redeemBy, so the check that fires is featureExpired, not
    // redemptionWindowElapsed - the two rejections have to stay distinguishable.
    const expiresAt = new Date('2026-01-01T01:00:00.000Z')

    const code = issueUnlockCode({
      features: ['watchlist'],
      launcherInstallId: INSTALL_ID,
      now,
      expiresAt,
      privateKey,
    })

    const afterExpiry = verifyUnlockCode(code, {
      publicKey,
      launcherInstallId: INSTALL_ID,
      now: new Date(expiresAt.getTime() + 1000),
      mode: 'redeem',
    })
    expect(afterExpiry).toEqual({ ok: false, reason: 'featureExpired' })
  })

  test('a label and an expiresAt both round-trip into the decoded payload', () => {
    const { publicKey, privateKey } = throwawayKeyPair()
    const now = new Date('2026-01-01T00:00:00.000Z')
    const expiresAt = new Date('2026-06-01T00:00:00.000Z')
    const label = 'LAN party giveaway #12'

    const code = issueUnlockCode({
      features: ['watchlist'],
      launcherInstallId: INSTALL_ID,
      now,
      expiresAt,
      label,
      privateKey,
    })

    const result = verifyUnlockCode(code, {
      publicKey,
      launcherInstallId: INSTALL_ID,
      now,
      mode: 'redeem',
    })

    expect(result.ok).toBe(true)
    expect(result).toMatchObject({
      ok: true,
      payload: { label, expiresAt: Math.floor(expiresAt.getTime() / 1000) },
    })
  })
})

describe('issueUnlockCode - input validation', () => {
  test('rejects an invalid feature name, an empty feature list and a bad install id', () => {
    const { privateKey } = throwawayKeyPair()

    expect(() =>
      issueUnlockCode({ features: ['Not-Valid'], launcherInstallId: INSTALL_ID, privateKey }),
    ).toThrow(/feature/)
    expect(() => issueUnlockCode({ features: [], launcherInstallId: INSTALL_ID, privateKey })).toThrow(
      /features/,
    )
    expect(() =>
      issueUnlockCode({ features: ['watchlist'], launcherInstallId: 'too-short', privateKey }),
    ).toThrow(/install id/)
  })
})

describe('issueUnlockCode - payload validity (AC8: a signed code must be accepted, not just signable)', () => {
  test('an expiresAt equal to issuedAt throws', () => {
    const { privateKey } = throwawayKeyPair()
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(() =>
      issueUnlockCode({
        features: ['watchlist'],
        launcherInstallId: INSTALL_ID,
        now,
        expiresAt: now,
        privateKey,
      }),
    ).toThrow(/expiresAt/)
  })

  test('an expiresAt before issuedAt throws', () => {
    const { privateKey } = throwawayKeyPair()
    const now = new Date('2026-01-01T00:00:00.000Z')
    const before = new Date(now.getTime() - 1000)
    expect(() =>
      issueUnlockCode({
        features: ['watchlist'],
        launcherInstallId: INSTALL_ID,
        now,
        expiresAt: before,
        privateKey,
      }),
    ).toThrow(/expiresAt/)
  })

  test('a redeemHours that would produce a non-integer redeemBy throws', () => {
    const { privateKey } = throwawayKeyPair()
    expect(() =>
      issueUnlockCode({
        features: ['watchlist'],
        launcherInstallId: INSTALL_ID,
        redeemHours: 1.0001,
        privateKey,
      }),
    ).toThrow(/redeemHours/)
  })

  test('expiresAt: null is treated as "not provided" - omitted from the payload, not coerced to 0', () => {
    const { publicKey, privateKey } = throwawayKeyPair()
    const now = new Date('2026-01-01T00:00:00.000Z')

    const code = issueUnlockCode({
      features: ['watchlist'],
      launcherInstallId: INSTALL_ID,
      now,
      expiresAt: null,
      privateKey,
    })

    const [, payloadB64] = code.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    expect(payload.expiresAt).toBeUndefined()
    expect('expiresAt' in payload).toBe(false)

    const result = verifyUnlockCode(code, {
      publicKey,
      launcherInstallId: INSTALL_ID,
      now,
      mode: 'redeem',
    })
    expect(result.ok).toBe(true)
  })
})

/** SSH wire-format `string`: uint32 length + bytes. */
function sshString(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  return Buffer.concat([length, bytes])
}

/** Serialises a Node Ed25519 key pair the way `ssh-keygen` / Bitwarden write it (OpenSSH format). */
function toOpenSsh({ publicKey, privateKey }, { cipher = 'none' } = {}) {
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url')
  const pubBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(pub)])
  const check = Buffer.from([1, 2, 3, 4])
  let privSection = Buffer.concat([
    check,
    check,
    sshString('ssh-ed25519'),
    sshString(pub),
    sshString(Buffer.concat([seed, pub])),
    sshString('test@example'),
  ])
  const padding = (8 - (privSection.length % 8)) % 8
  privSection = Buffer.concat([privSection, Buffer.from([1, 2, 3, 4, 5, 6, 7].slice(0, padding))])
  const count = Buffer.alloc(4)
  count.writeUInt32BE(1)
  const raw = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'latin1'),
    sshString(cipher),
    sshString('none'),
    sshString(''),
    count,
    sshString(pubBlob),
    sshString(privSection),
  ])
  const body = raw.toString('base64').match(/.{1,70}/g).join('\r\n')
  return {
    privateText: `-----BEGIN OPENSSH PRIVATE KEY-----\r\n${body}\r\n-----END OPENSSH PRIVATE KEY-----\r\n`,
    publicLine: `ssh-ed25519 ${pubBlob.toString('base64')} test@example`,
  }
}

describe('OpenSSH keys (Bitwarden SSH key) - signing and public-key conversion', () => {
  test('a code signed with an OpenSSH private key verifies against the converted OpenSSH public key', () => {
    const { privateText, publicLine } = toOpenSsh(throwawayKeyPair())

    const code = issueUnlockCode({
      features: ['watchlist'],
      launcherInstallId: INSTALL_ID,
      privateKey: loadSigningKey(privateText),
    })

    const result = verifyUnlockCode(code, {
      publicKey: openSshPublicKeyToPem(publicLine),
      launcherInstallId: INSTALL_ID,
      now: new Date(),
      mode: 'redeem',
    })
    expect(result.ok).toBe(true)
  })

  test('the converted public key is the same key Node exports as SPKI PEM', () => {
    const pair = throwawayKeyPair()
    const { publicLine } = toOpenSsh(pair)
    expect(openSshPublicKeyToPem(publicLine)).toBe(pair.publicKey.export({ type: 'spki', format: 'pem' }))
  })

  test('a passphrase-protected OpenSSH key is refused with a clear message', () => {
    const { privateText } = toOpenSsh(throwawayKeyPair(), { cipher: 'aes256-ctr' })
    expect(() => loadSigningKey(privateText)).toThrow(/passphrase/)
  })

  test('a non-Ed25519 key is refused, OpenSSH public keys of other types too', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(() => loadSigningKey(privateKey.export({ type: 'pkcs8', format: 'pem' }))).toThrow(/Ed25519/)
    expect(() => openSshPublicKeyToPem('ssh-rsa AAAAB3NzaC1yc2E= x')).toThrow(/ssh-ed25519/)
  })

  test('a PKCS8 PEM (what keygen writes) still loads', () => {
    const { privateKey } = throwawayKeyPair()
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    expect(loadSigningKey(pem).asymmetricKeyType).toBe('ed25519')
  })
})

describe('assertOutsideRepo - case-insensitive-filesystem-safe on Windows', () => {
  test('a --key path matching the repo root but with different case on a path segment throws', () => {
    // NTFS is case-insensitive: this candidate resolves to the exact same file as the exact-case
    // version already covered above, and must be refused identically.
    const differentCase = REPO_ROOT.replace(/[a-z]/, (char) => char.toUpperCase())
    expect(() =>
      resolveSigningKeyPath({
        argv: ['--key', `${differentCase}/scripts/unlock.pem`],
        env: {},
        repoRoot: REPO_ROOT,
      }),
    ).toThrow(/refusing/)
  })
})

describe('resolveSigningKeyPath - the signing key comes from --key or Q2L_UNLOCK_SIGNING_KEY_FILE and never from inside the repo', () => {
  test('--key pointing outside the repo wins', () => {
    const outside = process.platform === 'win32' ? 'C:\\keys\\unlock.pem' : '/keys/unlock.pem'
    const result = resolveSigningKeyPath({
      argv: ['--key', outside],
      env: {},
      repoRoot: REPO_ROOT,
    })
    expect(result.toLowerCase()).toBe(outside.toLowerCase())
  })

  test('Q2L_UNLOCK_SIGNING_KEY_FILE is used when --key is absent', () => {
    const outside = process.platform === 'win32' ? 'C:\\keys\\unlock.pem' : '/keys/unlock.pem'
    const result = resolveSigningKeyPath({
      argv: [],
      env: { Q2L_UNLOCK_SIGNING_KEY_FILE: outside },
      repoRoot: REPO_ROOT,
    })
    expect(result.toLowerCase()).toBe(outside.toLowerCase())
  })

  test('with neither set, falls back to the home-dir default', () => {
    const result = resolveSigningKeyPath({ argv: [], env: {}, repoRoot: REPO_ROOT })
    expect(result).toContain('.q2-launcher')
    expect(result).toContain('unlock-signing-key.pem')
  })

  test('a --key path inside the repo throws', () => {
    expect(() =>
      resolveSigningKeyPath({
        argv: ['--key', `${REPO_ROOT}/scripts/unlock.pem`],
        env: {},
        repoRoot: REPO_ROOT,
      }),
    ).toThrow(/refusing/)
  })

  test('a bare relative path resolves against the current working directory, inside the repo, and throws', () => {
    // resolveSigningKeyPath resolves relative candidates the same way `path.resolve` does: against
    // process.cwd(). This repo's tests always run from the repo root, so "./key.pem" lands inside it.
    expect(() =>
      resolveSigningKeyPath({ argv: ['--key', './key.pem'], env: {}, repoRoot: REPO_ROOT }),
    ).toThrow(/refusing/)
  })

  test('a relative path laundered through .. segments back inside the repo throws too', () => {
    const repoName = REPO_ROOT.split(/[\\/]/).filter(Boolean).pop()
    const laundered = `${REPO_ROOT}/../${repoName}/scripts/../key.pem`
    expect(() =>
      resolveSigningKeyPath({ argv: ['--key', laundered], env: {}, repoRoot: REPO_ROOT }),
    ).toThrow(/refusing/)
  })

  test('an env var pointing inside the repo throws even without --key', () => {
    expect(() =>
      resolveSigningKeyPath({
        argv: [],
        env: { Q2L_UNLOCK_SIGNING_KEY_FILE: `${REPO_ROOT}/key.pem` },
        repoRoot: REPO_ROOT,
      }),
    ).toThrow(/refusing/)
  })
})

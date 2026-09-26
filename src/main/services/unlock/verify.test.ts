import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { UnlockPayload } from '@shared/unlock'
import { encodeUnlockPayload, parseUnlockCode } from './code'
import { verifyUnlockCode, type VerifyUnlockOptions } from './verify'

const issuer = generateKeyPairSync('ed25519')
const foreign = generateKeyPairSync('ed25519')

const INSTALL_ID = 'ABCDEFGHJK23'
const OTHER_ID = 'ZZZZ7777QQQQ'
const NOW = new Date('2026-09-25T12:00:00Z')
const NOW_S = NOW.getTime() / 1000

function payload(overrides: Partial<UnlockPayload> = {}): UnlockPayload {
  return {
    features: ['servers-pro'],
    launcherInstallId: INSTALL_ID,
    issuedAt: NOW_S - 3600,
    redeemBy: NOW_S + 86_400,
    ...overrides,
  }
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}

/** Signs `signed` (the literal `q2l1.<payloadB64>` text) and appends the signature. */
function signed(signedText: string, key: KeyObject = issuer.privateKey): string {
  return `${signedText}.${sign(null, Buffer.from(signedText, 'ascii'), key).toString('base64url')}`
}

function code(p: UnlockPayload = payload(), key: KeyObject = issuer.privateKey): string {
  return signed(encodeUnlockPayload(p), key)
}

/** A code whose payload segment is arbitrary JSON text, validly signed by the issuer. */
function codeFromJson(json: string): string {
  return signed(`q2l1.${b64(json)}`)
}

function options(overrides: Partial<VerifyUnlockOptions> = {}): VerifyUnlockOptions {
  return { publicKey: issuer.publicKey, launcherInstallId: INSTALL_ID, now: NOW, mode: 'redeem', ...overrides }
}

describe('verifyUnlockCode', () => {
  it('a validly signed code for this installation inside its window is accepted', () => {
    const p = payload({ features: ['servers-pro', 'mods'], expiresAt: NOW_S + 3600, label: 'Beta' })
    expect(verifyUnlockCode(code(p), options())).toEqual({ ok: true, payload: p })
    expect(verifyUnlockCode(code(p), options({ mode: 'reverify' }))).toEqual({ ok: true, payload: p })
    // Surrounding whitespace from a paste is tolerated; a PEM string key works too.
    const pem = issuer.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(verifyUnlockCode(`  ${code(p)}\n`, options({ publicKey: pem })).ok).toBe(true)
  })

  it('verifies the exact signed bytes, not a re-serialisation of the payload', () => {
    // Same object, different bytes than JSON.stringify would produce: whitespace and key order.
    const json = `{ "redeemBy": ${NOW_S + 60}, "launcherInstallId": "${INSTALL_ID}", "issuedAt": ${NOW_S - 60}, "features": ["mods"] }`
    expect(verifyUnlockCode(codeFromJson(json), options()).ok).toBe(true)
  })

  it('a tampered payload or a foreign key\'s signature is rejected as badSignature', () => {
    // Payload changed after signing: the issuer's signature over the original stays attached.
    const original = code()
    const sig = original.split('.')[2]
    const tampered = `${encodeUnlockPayload(payload({ features: ['servers-pro', 'mods'] }))}.${sig}`
    expect(verifyUnlockCode(tampered, options())).toEqual({ ok: false, reason: 'badSignature' })

    // A single signature byte flipped.
    const sigBytes = Buffer.from(sig, 'base64url')
    sigBytes[0] ^= 0x01
    const flipped = `${original.split('.').slice(0, 2).join('.')}.${sigBytes.toString('base64url')}`
    expect(verifyUnlockCode(flipped, options())).toEqual({ ok: false, reason: 'badSignature' })

    // A well-formed code signed by a different Ed25519 key pair.
    expect(verifyUnlockCode(code(payload(), foreign.privateKey), options())).toEqual({
      ok: false,
      reason: 'badSignature',
    })
  })

  it('an unusable or non-Ed25519 key is a badSignature, never an exception', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 })
    const rsaSigned = `${encodeUnlockPayload(payload())}`
    const rsaCode = `${rsaSigned}.${sign(null, Buffer.from(rsaSigned, 'ascii'), rsa.privateKey).toString('base64url')}`
    for (const publicKey of ['not a key', '', rsa.publicKey] as const) {
      expect(() => verifyUnlockCode(code(), options({ publicKey }))).not.toThrow()
      expect(verifyUnlockCode(code(), options({ publicKey }))).toEqual({ ok: false, reason: 'badSignature' })
    }
    expect(verifyUnlockCode(rsaCode, options({ publicKey: rsa.publicKey }))).toEqual({
      ok: false,
      reason: 'badSignature',
    })
  })

  it('a code for another installation is rejected as wrongInstallation, distinct from badSignature', () => {
    const forOther = code(payload({ launcherInstallId: OTHER_ID }))
    const result = verifyUnlockCode(forOther, options())
    expect(result).toEqual({ ok: false, reason: 'wrongInstallation' })
    expect(result.ok === false && result.reason).not.toBe('badSignature')
    // No installation id on this machine is never a match.
    expect(verifyUnlockCode(code(), options({ launcherInstallId: null }))).toEqual({
      ok: false,
      reason: 'wrongInstallation',
    })
  })

  it('redeeming after redeem-by is rejected as redemptionWindowElapsed', () => {
    const p = payload({ issuedAt: NOW_S - 7200, redeemBy: NOW_S - 1 })
    expect(verifyUnlockCode(code(p), options())).toEqual({ ok: false, reason: 'redemptionWindowElapsed' })
    // The redeem-by second itself is still inside the window.
    expect(verifyUnlockCode(code(payload({ redeemBy: NOW_S })), options()).ok).toBe(true)
    // An invalid clock fails closed.
    expect(verifyUnlockCode(code(), options({ now: new Date(Number.NaN) }))).toEqual({
      ok: false,
      reason: 'redemptionWindowElapsed',
    })
  })

  it('reverifying a code past its redeem-by still accepts it (the window is redeem-only)', () => {
    const p = payload({ issuedAt: NOW_S - 7200, redeemBy: NOW_S - 3600 })
    expect(verifyUnlockCode(code(p), options({ mode: 'reverify' }))).toEqual({ ok: true, payload: p })
  })

  it('a code past its feature expiry is rejected as featureExpired in both modes', () => {
    const expired = code(payload({ expiresAt: NOW_S }))
    for (const mode of ['redeem', 'reverify'] as const) {
      expect(verifyUnlockCode(expired, options({ mode }))).toEqual({ ok: false, reason: 'featureExpired' })
    }
    // Past both redeem-by and expiry: reverify reports the expiry, not the window.
    const both = code(payload({ issuedAt: NOW_S - 7200, redeemBy: NOW_S - 3600, expiresAt: NOW_S - 60 }))
    expect(verifyUnlockCode(both, options({ mode: 'reverify' }))).toEqual({ ok: false, reason: 'featureExpired' })
    expect(verifyUnlockCode(both, options({ mode: 'redeem' }))).toEqual({
      ok: false,
      reason: 'redemptionWindowElapsed',
    })
  })

  it('a wrong prefix or malformed body is rejected as malformed before any signature check', () => {
    const valid = code()
    const [, payloadB64, sigB64] = valid.split('.')
    const base = { ...payload() }
    const malformed = [
      '',
      'q2l1',
      `q2l2.${payloadB64}.${sigB64}`,
      `Q2L1.${payloadB64}.${sigB64}`,
      `q2l1.${payloadB64}`,
      `q2l1.${payloadB64}.${sigB64}.extra`,
      `q2l1..${sigB64}`,
      `q2l1.${payloadB64}.`,
      // Not strict base64url: padding, standard-alphabet characters, anything else.
      `q2l1.${payloadB64}.${sigB64}=`,
      `q2l1.${payloadB64}=.${sigB64}`,
      `q2l1.${payloadB64.replace(/-|_/g, '+')}+.${sigB64}`,
      `q2l1.${payloadB64}.${sigB64}/`,
      `q2l1.${payloadB64} .${sigB64}`,
      // Non-canonical base64url: an impossible length, non-zero trailing bits.
      `q2l1.${payloadB64}.A`,
      `q2l1.${payloadB64}.AB`,
      // Not JSON / not UTF-8.
      `q2l1.${b64('{not json')}.${sigB64}`,
      `q2l1.${Buffer.from([0xff, 0xfe, 0x7b, 0x7d]).toString('base64url')}.${sigB64}`,
      // Schema and ordering violations, validly signed by the issuer.
      codeFromJson(JSON.stringify({ ...base, extra: true })),
      codeFromJson(JSON.stringify({ ...base, features: ['mods', 'mods'] })),
      codeFromJson(JSON.stringify({ ...base, features: [] })),
      codeFromJson(JSON.stringify({ ...base, features: ['Mods'] })),
      codeFromJson(JSON.stringify({ ...base, features: Array.from({ length: 17 }, (_, i) => `f${i}`) })),
      codeFromJson(JSON.stringify({ ...base, launcherInstallId: 'abcdefghjk23' })),
      codeFromJson(JSON.stringify({ ...base, redeemBy: base.issuedAt - 1 })),
      codeFromJson(JSON.stringify({ ...base, expiresAt: base.issuedAt })),
      codeFromJson(JSON.stringify({ ...base, issuedAt: 1.5 })),
      codeFromJson(JSON.stringify({ ...base, issuedAt: -1 })),
      codeFromJson(JSON.stringify({ ...base, label: '' })),
      codeFromJson(JSON.stringify({ ...base, label: 'x'.repeat(65) })),
      codeFromJson(JSON.stringify({ features: base.features, launcherInstallId: INSTALL_ID, issuedAt: 1 })),
      codeFromJson('[]'),
      codeFromJson('null'),
    ]
    for (const input of malformed) {
      expect(parseUnlockCode(input), input).toEqual({ ok: false, reason: 'malformed' })
      // An unusable key would turn any signature check into badSignature - malformed proves none ran.
      expect(verifyUnlockCode(input, options({ publicKey: 'not a key' })), input).toEqual({
        ok: false,
        reason: 'malformed',
      })
    }
  })
})

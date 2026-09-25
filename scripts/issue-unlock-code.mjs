// Story 128 D3: the unlock-code issuing script and the production signing-key workflow.
//
// This is a plain Node ESM script, deliberately with no project imports beyond Node's own
// built-ins: it has to run standalone (`node scripts/issue-unlock-code.mjs ...`) on whatever
// machine issues codes, without a build step. Because of that it cannot import `src/shared/unlock.ts`
// (a `.ts` file) or D1's zod-based `src/main/services/unlock/code.ts`, so the wire format - prefix
// `q2l1.`, strict unpadded base64url, the exact signed bytes `q2l1.<payloadB64>` - and the payload's
// validation rules (feature-name pattern, launcher-install-id pattern/normalisation) are re-stated
// here, byte-for-byte identical to those files. `issue-unlock-code.test.mjs`'s round-trip test
// against `verifyUnlockCode` is what keeps the two copies honest.
//
// The signing key never enters the repo. `resolveSigningKeyPath` refuses any candidate path that
// resolves inside the repo root, and `keygen` refuses to overwrite an existing key file - a lost or
// leaked signing key is unrecoverable for every code already issued under it, so both are hard
// errors, not warnings.
import { generateKeyPairSync, createPublicKey, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `<repo>/scripts/issue-unlock-code.mjs` -> `<repo>`. Never `process.cwd()` - a script invoked from
 * a subfolder, or via `npm run`, still has to resolve the same repo root. */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const DEFAULT_KEY_PATH = resolve(homedir(), '.q2-launcher', 'unlock-signing-key.pem')

// --- mirrors of src/shared/unlock.ts - keep byte-for-byte identical --------------------------

const UNLOCK_CODE_PREFIX = 'q2l1'
const FEATURE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const LAUNCHER_INSTALL_ID_PATTERN = /^[A-Z2-7]{12}$/

/** Mirrors `normalizeLauncherInstallId` in `src/shared/unlock.ts`. */
function normalizeLauncherInstallId(input) {
  const stripped = input.replace(/[\s-]/g, '')
  if (!/^[A-Za-z2-7]{12}$/.test(stripped)) return null
  const id = stripped.toUpperCase()
  return LAUNCHER_INSTALL_ID_PATTERN.test(id) ? id : null
}

// --- issuing -----------------------------------------------------------------------------------

/**
 * @typedef {Object} IssueUnlockCodeOptions
 * @property {string[]} features
 * @property {string} launcherInstallId
 * @property {Date|number} [expiresAt]
 * @property {string} [label]
 * @property {Date} [now]
 * @property {number} [redeemHours]
 * @property {import('node:crypto').KeyObject|string} privateKey
 */

/**
 * Builds and signs one unlock code. Pure aside from `crypto.sign` - no fs, no process exit - so it
 * is directly unit-testable with a throwaway key pair.
 *
 * @param {IssueUnlockCodeOptions} options
 * @returns {string} `q2l1.<payloadB64>.<sigB64>`
 */
export function issueUnlockCode(options) {
  const { features, launcherInstallId, expiresAt, label, now = new Date(), redeemHours = 24, privateKey } = options

  if (!Array.isArray(features) || features.length < 1 || features.length > 16) {
    throw new Error('issue-unlock-code: features must be an array of 1 to 16 entries')
  }
  for (const feature of features) {
    if (typeof feature !== 'string' || !FEATURE_NAME_PATTERN.test(feature)) {
      throw new Error(
        `issue-unlock-code: invalid feature name "${feature}" - must match ${FEATURE_NAME_PATTERN}`,
      )
    }
  }
  if (new Set(features).size !== features.length) {
    throw new Error('issue-unlock-code: features must be unique')
  }

  const normalizedInstallId = normalizeLauncherInstallId(String(launcherInstallId ?? ''))
  if (normalizedInstallId === null) {
    throw new Error(
      `issue-unlock-code: invalid launcher install id "${launcherInstallId}" - expected 12 base32 ` +
        'characters, grouped or not',
    )
  }

  const issuedAt = Math.floor(now.getTime() / 1000)

  if (typeof redeemHours !== 'number' || !Number.isFinite(redeemHours) || redeemHours <= 0) {
    throw new Error('issue-unlock-code: redeemHours must be a positive number')
  }
  const redeemBy = issuedAt + redeemHours * 3600
  if (!Number.isInteger(redeemBy) || redeemBy < issuedAt) {
    throw new Error(
      `issue-unlock-code: redeemHours "${redeemHours}" produces a non-integer or invalid redeemBy - ` +
        "D1's verifier requires an integer epoch-seconds redeemBy greater than or equal to issuedAt",
    )
  }

  /** @type {Record<string, unknown>} */
  const payload = {
    features,
    launcherInstallId: normalizedInstallId,
    issuedAt,
    redeemBy,
  }

  // `expiresAt: null` (or any other nullish value) means "not provided", same as `undefined` - it
  // must never be coerced into `expiresAt: 0` in the signed payload.
  if (expiresAt !== undefined && expiresAt !== null) {
    const expiresAtSeconds =
      expiresAt instanceof Date ? Math.floor(expiresAt.getTime() / 1000) : Math.floor(expiresAt)
    if (!Number.isInteger(expiresAtSeconds) || expiresAtSeconds <= issuedAt) {
      throw new Error(
        `issue-unlock-code: invalid expiresAt - must resolve to an integer epoch-seconds value ` +
          'strictly after issuedAt',
      )
    }
    payload.expiresAt = expiresAtSeconds
  }

  if (label !== undefined) {
    if (typeof label !== 'string' || label.length < 1 || label.length > 64) {
      throw new Error('issue-unlock-code: label must be 1 to 64 characters')
    }
    payload.label = label
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signedBytes = Buffer.from(`${UNLOCK_CODE_PREFIX}.${payloadB64}`, 'ascii')
  const signature = sign(null, signedBytes, privateKey)
  const sigB64 = signature.toString('base64url')

  return `${UNLOCK_CODE_PREFIX}.${payloadB64}.${sigB64}`
}

// --- signing-key path resolution -----------------------------------------------------------

/**
 * Resolves the private-key PEM path an issuing/keygen run should use, and refuses one that lands
 * inside the repo: `--key` -> `Q2L_UNLOCK_SIGNING_KEY_FILE` -> `~/.q2-launcher/unlock-signing-key.pem`.
 *
 * Both the candidate and `repoRoot` are resolved to absolute, normalised paths before the
 * inside-repo check runs, so a relative path (`./key.pem`, or one laundered through `..` segments)
 * cannot defeat it by string mismatch alone - only where it actually points matters.
 *
 * @param {{ argv: string[], env: Record<string, string|undefined>, repoRoot: string }} options
 * @returns {string}
 */
export function resolveSigningKeyPath(options) {
  const { argv, env, repoRoot } = options

  let candidate
  const keyFlagIndex = argv.indexOf('--key')
  if (keyFlagIndex !== -1) {
    const value = argv[keyFlagIndex + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error('issue-unlock-code: --key needs a path')
    }
    candidate = value
  } else if (env.Q2L_UNLOCK_SIGNING_KEY_FILE) {
    candidate = env.Q2L_UNLOCK_SIGNING_KEY_FILE
  } else {
    candidate = DEFAULT_KEY_PATH
  }

  assertOutsideRepo(candidate, repoRoot)
  return resolve(candidate)
}

/**
 * Throws when `candidatePath` resolves inside `repoRoot`. Exported so `keygen --out` can reuse the
 * exact same check the read side uses.
 *
 * @param {string} candidatePath
 * @param {string} repoRoot
 */
export function assertOutsideRepo(candidatePath, repoRoot) {
  const resolvedCandidate = resolve(candidatePath)
  const resolvedRoot = resolve(repoRoot)
  // Compared case-insensitively unconditionally: NTFS (Windows) is case-insensitive, so a
  // case-only difference on any path segment still resolves to the same file there, and a
  // case-sensitive comparison would fail to catch it as "inside the repo". Lower-casing is safe
  // on case-sensitive filesystems too - it only ever makes the check MORE conservative (catches a
  // superset of what an exact-case comparison would), never less.
  const candidateLower = resolvedCandidate.toLowerCase()
  const rootLower = resolvedRoot.toLowerCase()
  const boundary = rootLower.endsWith(sep) ? rootLower : rootLower + sep
  if (candidateLower === rootLower || candidateLower.startsWith(boundary)) {
    throw new Error(
      `issue-unlock-code: refusing a signing-key path inside the repo ("${candidatePath}" resolves ` +
        `to "${resolvedCandidate}"). The signing key must never enter the repository - point --key ` +
        'or Q2L_UNLOCK_SIGNING_KEY_FILE somewhere outside it.',
    )
  }
}

// --- CLI ------------------------------------------------------------------------------------

/** @param {string[]} argv @param {string} flag @returns {string|undefined} */
function readFlagValue(argv, flag) {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`issue-unlock-code: ${flag} needs a value`)
  }
  return value
}

function runKeygen(argv) {
  const outFlag = readFlagValue(argv, '--out')
  const outPath = outFlag !== undefined ? resolve(outFlag) : DEFAULT_KEY_PATH
  assertOutsideRepo(outPath, REPO_ROOT)

  if (existsSync(outPath)) {
    throw new Error(
      `issue-unlock-code: refusing to overwrite an existing signing key at "${outPath}"`,
    )
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, privatePem, { encoding: 'utf-8', mode: 0o600 })

  console.log(`issue-unlock-code: wrote a new Ed25519 signing key to ${outPath}`)
  console.log('issue-unlock-code: matching public key (embed this in the launcher):')
  console.log(publicPem.toString())
}

function runIssue(argv) {
  const keyPath = resolveSigningKeyPath({ argv, env: process.env, repoRoot: REPO_ROOT })
  const privateKey = readFileSync(keyPath, 'utf-8')

  const featuresValue = readFlagValue(argv, '--features')
  const installIdValue = readFlagValue(argv, '--install-id')
  if (!featuresValue || !installIdValue) {
    throw new Error(
      'issue-unlock-code: --features <a,b,c> and --install-id <XXXX-XXXX-XXXX> are required',
    )
  }
  const features = featuresValue
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean)

  const label = readFlagValue(argv, '--label')

  const expiresIso = readFlagValue(argv, '--expires')
  const expiresInDays = readFlagValue(argv, '--expires-in-days')
  if (expiresIso !== undefined && expiresInDays !== undefined) {
    throw new Error('issue-unlock-code: pass either --expires or --expires-in-days, not both')
  }
  let expiresAt
  if (expiresIso !== undefined) {
    const parsed = new Date(expiresIso)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`issue-unlock-code: --expires "${expiresIso}" is not a valid date`)
    }
    expiresAt = parsed
  } else if (expiresInDays !== undefined) {
    const days = Number(expiresInDays)
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error(`issue-unlock-code: --expires-in-days "${expiresInDays}" must be a positive number`)
    }
    expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000)
  }

  const now = new Date()
  const code = issueUnlockCode({ features, launcherInstallId: installIdValue, expiresAt, label, now, privateKey })

  const normalizedInstallId = normalizeLauncherInstallId(installIdValue)
  const redeemBy = new Date(Math.floor(now.getTime() / 1000) * 1000 + 24 * 3600 * 1000)

  console.log(code)
  const summaryParts = [
    `features: ${features.join(', ')}`,
    `install id: ${normalizedInstallId}`,
    `redeem by: ${redeemBy.toISOString()}`,
  ]
  if (expiresAt !== undefined) {
    summaryParts.push(`expires: ${expiresAt.toISOString()}`)
  }
  if (label !== undefined) {
    summaryParts.push(`label: ${label}`)
  }
  console.log(summaryParts.join(' | '))
}

function main() {
  const argv = process.argv.slice(2)
  try {
    if (argv[0] === 'keygen') {
      runKeygen(argv.slice(1))
    } else {
      runIssue(argv)
    }
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/** True when this file was run directly, not imported - mirrors `release.mjs`'s guard, which keeps
 * the tests from actually generating keys or printing to the real stdout. */
function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  const self = fileURLToPath(import.meta.url)
  return process.platform === 'win32'
    ? resolve(entry).toLowerCase() === self.toLowerCase()
    : resolve(entry) === self
}

if (isDirectRun()) {
  process.exitCode = main()
}

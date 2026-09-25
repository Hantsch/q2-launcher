// Story 129 D4: the story's own end-to-end proof, over a real `UnlockService` (128) driven through
// the Settings unlock panel (`src/renderer/src/components/unlock/UnlockCodePanel.tsx`, D2) with a
// throwaway Ed25519 key pair - never the embedded production key.
//
// `setup()` generates the key pair and hands the harness-only public-key override
// (`Q2L_UI_UNLOCK_PUBLIC_KEY`, `src/main/services/unlock/public-key.ts`) to the app through `env`,
// the same "compute before `withApp()`, thread through `childEnv()`" pattern
// `bootstrap-no-engine-for-platform.mjs` uses for its fixture-server base URL. `Q2L_UI_HARNESS`
// itself needs no attention here - `childEnv()` (scripts/lib/harness.mjs) sets it unconditionally on
// every harness launch. The private key never leaves this module's own scope; only its public half
// crosses into the child process's environment.
//
// Codes are built and signed inline, reproducing `scripts/issue-unlock-code.mjs`'s wire format
// byte-for-byte (that file's own top comment explains why it cannot import `src/shared/unlock.ts` or
// `src/main/services/unlock/code.ts` - it has to run standalone with no build step, and this flow,
// also a plain `.mjs` file with no TypeScript loader, is in exactly the same position): prefix
// `q2l1.`, `JSON.stringify(payload)` as UTF-8 base64url (no padding), signed as the exact ASCII bytes
// `q2l1.<payloadB64>` with Ed25519, the signature itself base64url-encoded the same way. `issueUnlockCode`
// is not reused directly - it lives in a plain Node script this flow could `import`, but its CLI/keygen
// concerns (signing-key file path resolution, `--flag` parsing) are not needed here, and reproducing the
// ~15-line wire format inline keeps this flow free of a dependency on another script's argv-shaped API.
//
// ## Selectors, not guesses (`UnlockCodePanel.tsx`)
//
//   nav-settings              TitleBar.tsx - opens Settings
//   unlock-installation-id    <code> showing `XXXX-XXXX-XXXX`
//   unlock-copy-id            copies it to the clipboard via `app:copyText`
//   unlock-code-input         the redeem text input
//   unlock-code-submit        submits it via `unlock:redeem`
//   unlock-result-rejected    role=alert, one of five `settings.unlock.reject.<reason>` strings
//   unlock-result-accepted    role=status, features + expiry + "takes effect next start"
//   unlock-codes              the stored-codes list
//   unlock-code-row           one stored code - repeated, so every read below scopes by the unique
//                             per-run `label` this flow issues (AC3/AC5's own idempotency need)
//
// AC5's restart mirrors `servers-master-sources.mjs`'s own restart phase: a second, independent
// `withApp()` over a fresh `variantUserDataDir()`, seeded with nothing but a copy of phase 1's own
// `state.json` - the same file a real second boot on the same machine would read - and the same
// `env` (the public-key override) `setup()` already computed, since the restarted process still has
// to verify the same throwaway-signed codes.
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../lib/paths.mjs'
import { variantUserDataDir, withApp } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000

/** `UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV` (`src/main/services/unlock/public-key.ts`). */
const PUBLIC_KEY_ENV_VAR = 'Q2L_UI_UNLOCK_PUBLIC_KEY'

/** Mirrors `UNLOCK_CODE_PREFIX` (`src/shared/unlock.ts`). */
const CODE_PREFIX = 'q2l1'

/** Set by `setup()`, read by the flow body - the private key never crosses into the child process;
 * the public PEM is kept too, so the AC5 restart phase's own `withApp()` call can hand the same
 * override to the second launch without regenerating (and thereby invalidating) the key pair. */
let signingPrivateKey = null
let signingPublicKeyPem = null

export async function setup() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  signingPrivateKey = privateKey
  signingPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return { env: { [PUBLIC_KEY_ENV_VAR]: signingPublicKeyPem } }
}

/**
 * Builds and signs one unlock code, mirroring `issueUnlockCode`
 * (`scripts/issue-unlock-code.mjs`) / `encodeUnlockPayload` (`src/main/services/unlock/code.ts`).
 * `key` defaults to this run's own signing key - a caller only ever overrides it to produce a
 * signature that verifies under a DIFFERENT key (there is no other way to get `bad-signature` from a
 * structurally valid payload without it).
 */
function buildCode(payload, key = signingPrivateKey) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const unsigned = `${CODE_PREFIX}.${payloadB64}`
  const signature = cryptoSign(null, Buffer.from(unsigned, 'ascii'), key)
  return `${unsigned}.${signature.toString('base64url')}`
}

/** Flips one byte of a validly-signed code's own signature segment - the only way to get a
 * structurally valid, wrong-signature code without a second key pair. */
function withFlippedSignatureByte(code) {
  const [prefix, payloadB64, sigB64] = code.split('.')
  const signature = Buffer.from(sigB64, 'base64url')
  signature[0] ^= 0x01
  return `${prefix}.${payloadB64}.${signature.toString('base64url')}`
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

async function openSettings(page) {
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('unlock-installation-id').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

async function readInstallationId(page) {
  return (await page.getByTestId('unlock-installation-id').innerText()).trim()
}

async function submitCode(page, code) {
  const input = page.getByTestId('unlock-code-input')
  await input.fill('', { timeout: TIMEOUT_MS })
  await input.fill(code, { timeout: TIMEOUT_MS })
  await page.getByTestId('unlock-code-submit').click({ timeout: TIMEOUT_MS })
}

async function readRejection(page) {
  const rejected = page.getByTestId('unlock-result-rejected')
  await rejected.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return (await rejected.innerText()).trim()
}

function codeRowByLabel(page, label) {
  return page.getByTestId('unlock-codes').getByTestId('unlock-code-row').filter({ hasText: label })
}

export default async function unlockCode({ page, app, shot, step, variant }) {
  const userDataDir = variantUserDataDir(variant)

  step('open Settings and read the installation id (AC1)')
  await openSettings(page)
  const installationId = await readInstallationId(page)
  if (!/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(installationId)) {
    throw new Error(`expected a formatted 12-char base32 installation id, got: ${JSON.stringify(installationId)}`)
  }
  const normalizedInstallId = installationId.replace(/-/g, '')

  step('copy installation id writes it to the clipboard (AC1)')
  await page.getByTestId('unlock-copy-id').click({ timeout: TIMEOUT_MS })
  const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText())
  if (clipboardText !== installationId) {
    throw new Error(`expected the clipboard to hold ${JSON.stringify(installationId)}, got ${JSON.stringify(clipboardText)}`)
  }
  await shot('installation-id')

  step('reject: not a code at all (AC2)')
  await submitCode(page, 'hello')
  const notACodeText = await readRejection(page)

  step('reject: a validly-constructed code with a flipped signature byte (AC2)')
  const validBase = buildCode({
    features: ['watchlist'],
    launcherInstallId: normalizedInstallId,
    issuedAt: nowSeconds() - 10,
    redeemBy: nowSeconds() + 3600,
  })
  await submitCode(page, withFlippedSignatureByte(validBase))
  const badSignatureText = await readRejection(page)

  step('reject: validly-signed code for a different installation (AC2)')
  const wrongInstallCode = buildCode({
    features: ['watchlist'],
    launcherInstallId: 'ZZZZZZZZZZZZ',
    issuedAt: nowSeconds() - 10,
    redeemBy: nowSeconds() + 3600,
  })
  await submitCode(page, wrongInstallCode)
  const wrongInstallationText = await readRejection(page)

  step('reject: validly-signed code whose redeem-by has already passed (AC2)')
  const redeemElapsedCode = buildCode({
    features: ['watchlist'],
    launcherInstallId: normalizedInstallId,
    issuedAt: nowSeconds() - 3600,
    redeemBy: nowSeconds() - 60,
  })
  await submitCode(page, redeemElapsedCode)
  const redeemElapsedText = await readRejection(page)

  step('reject: validly-signed code whose feature expiry has already passed (AC2)')
  const featureExpiredCode = buildCode({
    features: ['watchlist'],
    launcherInstallId: normalizedInstallId,
    issuedAt: nowSeconds() - 3600,
    redeemBy: nowSeconds() + 3600,
    expiresAt: nowSeconds() - 10,
  })
  await submitCode(page, featureExpiredCode)
  const featureExpiredText = await readRejection(page)
  await shot('rejections')

  const rejectionTexts = {
    'not-a-code': notACodeText,
    'bad-signature': badSignatureText,
    'wrong-installation': wrongInstallationText,
    'redeem-window-elapsed': redeemElapsedText,
    'feature-expired': featureExpiredText,
  }
  // `en.json`'s own `settings.unlock.reject.<reason>` strings, kept as a literal copy here so this
  // assertion is against the exact rendered prose, not merely "some text appeared" - the same
  // discipline `bootstrap-no-engine-for-platform.mjs` applies to its own empty-state copy.
  const EXPECTED_REJECTION_TEXT = {
    'not-a-code': "That doesn't look like an unlock code.",
    'bad-signature': "This code isn't valid — it doesn't match what an unlock code should look like.",
    'wrong-installation': "This code was issued for a different installation and can't be redeemed here.",
    'redeem-window-elapsed': "This code's redemption window has passed.",
    'feature-expired': "This code's features have already expired.",
  }
  for (const [reason, text] of Object.entries(rejectionTexts)) {
    if (text !== EXPECTED_REJECTION_TEXT[reason]) {
      throw new Error(
        `expected the ${reason} rejection to read ${JSON.stringify(EXPECTED_REJECTION_TEXT[reason])}, got ${JSON.stringify(text)}`,
      )
    }
    if (text.includes('settings.unlock')) {
      throw new Error(`expected rendered prose for ${reason}, not a raw i18n key: ${JSON.stringify(text)}`)
    }
  }
  const distinctTexts = new Set(Object.values(rejectionTexts))
  if (distinctTexts.size !== Object.keys(rejectionTexts).length) {
    throw new Error(`expected five pairwise-different rejection texts, got: ${JSON.stringify(rejectionTexts)}`)
  }

  step('accept: a validly-signed code unlocking "watchlist" with a short feature expiry (AC3)')
  const uniqueLabel = `unlock-flow-${Date.now()}`
  const acceptExpiresAtMs = Date.now() + 10_000
  const acceptExpiresAtS = Math.floor(acceptExpiresAtMs / 1000)
  const acceptedCode = buildCode({
    features: ['watchlist'],
    launcherInstallId: normalizedInstallId,
    issuedAt: nowSeconds() - 10,
    redeemBy: nowSeconds() + 3600,
    expiresAt: acceptExpiresAtS,
    label: uniqueLabel,
  })
  await submitCode(page, acceptedCode)

  const accepted = page.getByTestId('unlock-result-accepted')
  await accepted.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const acceptedText = await accepted.innerText()
  if (!acceptedText.includes('watchlist')) {
    throw new Error(`expected the accepted result to name the unlocked feature "watchlist", got: ${JSON.stringify(acceptedText)}`)
  }
  if (acceptedText.includes('Does not expire')) {
    throw new Error(`expected a real expiry, not the "no expiry" text: ${JSON.stringify(acceptedText)}`)
  }
  await shot('accepted')

  const acceptedRow = codeRowByLabel(page, uniqueLabel)
  await acceptedRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('codes-list')

  // Read back what phase 2 must see from disk, the same way `servers-master-sources.mjs` proves its
  // own restart phase against the persisted bytes rather than re-derived in-memory state.
  const onDiskAfterAccept = JSON.parse(readFileSync(join(userDataDir, 'state.json'), 'utf8'))
  const storedCodes = onDiskAfterAccept.unlock?.codes
  if (!Array.isArray(storedCodes) || !storedCodes.some((entry) => entry.code === acceptedCode)) {
    throw new Error(`expected state.json's unlock.codes to contain the accepted code, got: ${JSON.stringify(storedCodes)}`)
  }

  step('wait for the 10s feature expiry to pass, then restart the app (AC5)')
  const waitMs = acceptExpiresAtMs - Date.now() + 1_000
  if (waitMs > 0) await new Promise((done) => setTimeout(done, waitMs))

  const restartVariant = `${variant}-unlock-code-restart`
  const restartUserDataDir = variantUserDataDir(restartVariant)
  mkdirSync(restartUserDataDir, { recursive: true })
  copyFileSync(join(userDataDir, 'state.json'), join(restartUserDataDir, 'state.json'))

  const restartEnv = { [PUBLIC_KEY_ENV_VAR]: signingPublicKeyPem }

  await withApp(
    { variant: restartVariant, viewport: { width: 1280, height: 800 }, env: restartEnv },
    async ({ page: secondPage }) => {
      await openSettings(secondPage)
      const restartedRow = codeRowByLabel(secondPage, uniqueLabel)
      await restartedRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      const rowText = await restartedRow.innerText()
      const expectedDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(acceptExpiresAtMs)
      const expectedExpiredText = `This code expired on ${expectedDate} — its features are no longer available.`
      if (!rowText.includes(expectedExpiredText)) {
        throw new Error(
          `expected the restarted app's row for "${uniqueLabel}" to show ${JSON.stringify(expectedExpiredText)}, got: ${JSON.stringify(rowText)}`,
        )
      }
      await secondPage.screenshot({
        path: join(REPO_ROOT, '.ui-verify', 'screenshots', 'flows', 'unlock-code-restarted-expired.png'),
      })
    },
  )
}

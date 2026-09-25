import type { KeyObject } from 'node:crypto'
import type { UnlockRejection, UnlockSnapshot, UnlockVerdict } from '@shared/unlock'
import { MAX_UNLOCK_CODES, type UnlockCodeEntry, type UnlockState } from '../../lib/schemas'
import { resolveLauncherInstallId as defaultResolveLauncherInstallId } from './launcher-install-id'
import { verifyUnlockCode } from './verify'

/**
 * Story 128 D4: the unlock-code service - a shell service, not a module (it has no per-installation
 * data and nothing renderer-writable to validate), constructed the same way `update`/`launch`/`jobs`
 * are in `context.ts`.
 *
 * Verification (`verifyUnlockCode`, D1-D3) is the only place a code is judged; this service is
 * purely the persistence and in-memory-cache layer around it. `init()` resolves the launcher
 * installation id exactly once and caches it, then re-verifies every stored code in `'reverify'`
 * mode - the redemption window is redeem-only and is never checked again once a code is stored, so
 * a code that was valid to redeem stays unlocked even after that window has closed; only signature,
 * installation and feature expiry are re-checked on every subsequent verification.
 *
 * **Never logs a raw code body or the raw machine value.** The machine value already never escapes
 * `launcher-install-id.ts`; this service additionally never writes a full code into a log line -
 * only feature names and rejection reasons, which carry no secret.
 */

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`), same convention as `UpdateServiceLog`. */
export interface UnlockServiceLog {
  warn(message: string): void
  error(message: string): void
}

export interface UnlockServiceState {
  unlockState(): UnlockState
  setUnlockState(state: UnlockState): UnlockState
}

export interface UnlockServiceOptions {
  state: UnlockServiceState
  publicKey: KeyObject | string
  /** Defaults to the real machine-derived resolver; injectable for tests. */
  resolveLauncherInstallId?: () => Promise<string | null>
  /** Defaults to `() => new Date()`; injectable for tests. */
  now?: () => Date
  log?: UnlockServiceLog
}

export interface UnlockService {
  init(): Promise<void>
  isUnlocked(feature: string): boolean
  unlockedFeatures(): ReadonlySet<string>
  redeem(code: string): UnlockVerdict
  snapshot(): UnlockSnapshot
}

/** One stored code's current classification, shared by `init()` and `snapshot()`. */
interface ClassifiedCode {
  entry: UnlockCodeEntry
  status: 'active' | UnlockRejection
  features: string[]
  label?: string
  expiresAt?: number
}

export function createUnlockService(options: UnlockServiceOptions): UnlockService {
  const resolveInstallId = options.resolveLauncherInstallId ?? defaultResolveLauncherInstallId
  const now = options.now ?? ((): Date => new Date())
  const log = options.log

  let launcherInstallId: string | null = null
  let activeFeatures = new Set<string>()

  /** Re-verifies one stored code and classifies it - the shared logic `init()` and `snapshot()` both need. */
  function classify(entry: UnlockCodeEntry): ClassifiedCode {
    const verdict = verifyUnlockCode(entry.code, {
      publicKey: options.publicKey,
      launcherInstallId,
      now: now(),
      mode: 'reverify',
    })

    if (verdict.ok) {
      return {
        entry,
        status: 'active',
        features: verdict.payload.features,
        label: verdict.payload.label,
        expiresAt: verdict.payload.expiresAt,
      }
    }
    return { entry, status: verdict.reason, features: [] }
  }

  function recomputeActiveFeatures(): void {
    const codes = options.state.unlockState().codes
    const next = new Set<string>()
    for (const entry of codes) {
      const classified = classify(entry)
      if (classified.status !== 'active') continue
      for (const feature of classified.features) next.add(feature)
    }
    activeFeatures = next
  }

  async function init(): Promise<void> {
    try {
      launcherInstallId = await resolveInstallId()
    } catch {
      // `resolveLauncherInstallId` never throws by contract, but a hostile/broken injected stub in
      // a test still should not be able to crash boot - the honest fallback is "unknown machine".
      launcherInstallId = null
    }
    recomputeActiveFeatures()
    log?.warn(`unlock: initialised with ${activeFeatures.size} active feature(s)`)
  }

  function isUnlocked(feature: string): boolean {
    return activeFeatures.has(feature)
  }

  function unlockedFeatures(): ReadonlySet<string> {
    return activeFeatures
  }

  function redeem(rawCode: string): UnlockVerdict {
    // `parseUnlockCode` (code.ts) trims its input before verifying; dedupe/storage below must use
    // that same trimmed form, or the same logical code pasted with/without surrounding whitespace
    // produces two distinct stored rows.
    const code = rawCode.trim()
    const verdict = verifyUnlockCode(code, {
      publicKey: options.publicKey,
      launcherInstallId,
      now: now(),
      mode: 'redeem',
    })

    if (!verdict.ok) {
      log?.warn(`unlock: redemption rejected (${verdict.reason})`)
      return verdict
    }

    const current = options.state.unlockState()
    const withoutThisCode = current.codes.filter((entry) => entry.code !== code)
    const nextEntry: UnlockCodeEntry = { code, redeemedAt: now().toISOString() }
    // Cap explicitly here, keeping the most-recently-redeemed MAX_UNLOCK_CODES entries (including
    // the one just added) - `parseUnlockState`'s own cap runs on load/parse and truncates by
    // array-position after dedupe, not "newest wins", so relying on it here would silently drop the
    // code just redeemed instead of an old one.
    const combined = [...withoutThisCode, nextEntry].sort(
      (a, b) => Date.parse(a.redeemedAt) - Date.parse(b.redeemedAt),
    )
    const capped = combined.slice(Math.max(0, combined.length - MAX_UNLOCK_CODES))
    options.state.setUnlockState({ codes: capped })

    for (const feature of verdict.payload.features) activeFeatures.add(feature)

    log?.warn(`unlock: redeemed code unlocking feature(s): ${verdict.payload.features.join(', ')}`)
    return { ok: true, features: verdict.payload.features }
  }

  function snapshot(): UnlockSnapshot {
    const codes = options.state.unlockState().codes.map((entry) => {
      const classified = classify(entry)
      return {
        features: classified.features,
        ...(classified.label !== undefined ? { label: classified.label } : {}),
        ...(classified.expiresAt !== undefined ? { expiresAt: classified.expiresAt } : {}),
        redeemedAt: entry.redeemedAt,
        status: classified.status,
      }
    })
    return { launcherInstallId, codes }
  }

  return { init, isUnlocked, unlockedFeatures, redeem, snapshot }
}

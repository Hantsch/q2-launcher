import { formatLauncherInstallId, type UnlockRejection, type UnlockSnapshot } from '@shared/unlock'
import {
  ok,
  type RedeemedCode,
  type RedeemResult,
  type UnlockRejectReason,
  type UnlockState,
} from '@shared/types'
import { unlockGetStateSchema, unlockRedeemSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle, handleOutcome } from './index'

/**
 * Story 129: the renderer's window onto story 128's `UnlockService`. Registered unconditionally -
 * asking for a code is how a locked feature gets unlocked, so it cannot itself be gated.
 *
 * Nothing here verifies anything: `getState` reads the service's start-time classification and
 * `redeem` goes through the service's own redeem path. Only reason ids cross IPC, never prose, and
 * never a raw code body.
 */
export function registerUnlockIpc(app: AppContext): void {
  handle('unlock:getState', unlockGetStateSchema, (): UnlockState => {
    return toUnlockState(app.unlock.snapshot())
  })

  // A refused code is an answer (`ok({ ok: false, reason })`), not a failed `Outcome` - the failed
  // `Outcome` is kept for a payload the schema refused before the service was ever called.
  handleOutcome('unlock:redeem', unlockRedeemSchema, (code) => {
    const verdict = app.unlock.redeem(code)
    if (!verdict.ok) {
      return ok<RedeemResult>({ ok: false, reason: toRejectReason(verdict.reason) })
    }
    return ok<RedeemResult>({
      ok: true,
      code: {
        features: verdict.features,
        featureExpiry: toEpochMs(verdict.expiresAt),
        label: verdict.label ?? null,
        status: 'active',
      },
    })
  })
}

/**
 * 1:1 onto the verifier's rejections. Deliberately a switch with no `default`: a rejection added to
 * `UNLOCK_REJECTIONS` without a reason here is a compile error, never a generic fallback reason.
 */
function toRejectReason(reason: UnlockRejection): UnlockRejectReason {
  switch (reason) {
    case 'malformed':
      return 'not-a-code'
    case 'badSignature':
      return 'bad-signature'
    case 'wrongInstallation':
      return 'wrong-installation'
    case 'redemptionWindowElapsed':
      return 'redeem-window-elapsed'
    case 'featureExpired':
      return 'feature-expired'
  }
}

/**
 * Active and expired codes are listed; a stored code that no longer verifies for any other reason
 * (a rotated key, another machine) cannot be described honestly, so it is left out - it unlocks
 * nothing either way and stays in storage untouched.
 */
function toUnlockState(snapshot: UnlockSnapshot): UnlockState {
  const codes: RedeemedCode[] = []
  for (const entry of snapshot.codes) {
    if (entry.status !== 'active' && entry.status !== 'featureExpired') continue
    codes.push({
      features: entry.features,
      featureExpiry: toEpochMs(entry.expiresAt),
      label: entry.label ?? null,
      status: entry.status === 'active' ? 'active' : 'expired',
    })
  }
  return {
    installationId:
      snapshot.launcherInstallId === null ? '' : formatLauncherInstallId(snapshot.launcherInstallId),
    codes,
  }
}

/** Codes carry epoch seconds; the renderer contract speaks epoch milliseconds. */
function toEpochMs(seconds: number | undefined): number | null {
  return seconds === undefined ? null : seconds * 1000
}

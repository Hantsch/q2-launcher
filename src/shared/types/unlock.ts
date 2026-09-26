/**
 * Story 129: what the renderer learns about unlock codes over IPC. Reason ids only, never prose -
 * the renderer owns every user-visible string.
 */

/** Why a code was refused - one id per verification step in `src/main/services/unlock/verify.ts`. */
export type UnlockRejectReason =
  | 'not-a-code'
  | 'bad-signature'
  | 'wrong-installation'
  | 'redeem-window-elapsed'
  | 'feature-expired'

/** One stored code as the renderer sees it. The raw code body never crosses IPC. */
export interface RedeemedCode {
  features: string[]
  /** When the code's features expire, in epoch milliseconds; `null` when they never do. */
  featureExpiry: number | null
  label: string | null
  /** `expired` codes stay stored and listed, but unlock nothing. */
  status: 'active' | 'expired'
}

export interface UnlockState {
  /** This launcher installation's id, grouped as `XXXX-XXXX-XXXX`; empty when it could not be resolved. */
  installationId: string
  codes: RedeemedCode[]
}

export type RedeemResult = { ok: true; code: RedeemedCode } | { ok: false; reason: UnlockRejectReason }

import { z } from 'zod'
import { parseForgivingEnvelope, parseKeyedRows } from '../../lib/forgiving'
import type { StateSection, StateSectionSpec, StateStore } from '../state'

/**
 * One persisted unlock-code redemption row. Only `code` and `redeemedAt` are ever stored - the
 * features/label/expiry are re-derived by re-verifying the code itself (`UnlockService`), never
 * persisted redundantly, so there is nothing here that could drift from what the code actually says.
 */
export interface UnlockCodeEntry {
  code: string
  redeemedAt: string
}

export interface UnlockState {
  codes: UnlockCodeEntry[]
}

/**
 * Well above anything a real user redeems; bounds work on a hand-edited or foreign file. Exported so
 * `UnlockService.redeem` can apply the same cap itself, keeping the newest entries, instead of
 * relying on the load-time truncation (which is not "keep the newest").
 */
export const MAX_UNLOCK_CODES = 32

const unlockCodeEntrySchema = z.object({
  code: z.string().min(1),
  redeemedAt: z.string().min(1),
})

const unlockStateEnvelopeSchema = z.object({
  codes: z.array(z.unknown()).catch([]),
})

/**
 * Missing input (a `state.json` predating the key) degrades to `{ codes: [] }`; rows are deduped by
 * `code` (first wins), then capped at `MAX_UNLOCK_CODES` - the cap truncates the tail after dedupe.
 */
export function parseUnlockState(raw: unknown): UnlockState {
  const envelope = parseForgivingEnvelope(unlockStateEnvelopeSchema, raw, () => ({ codes: [] }))
  const codes = parseKeyedRows(unlockCodeEntrySchema, envelope.codes, {
    keyOf: (row) => row.code,
  }).slice(0, MAX_UNLOCK_CODES)
  return { codes }
}

const unlockSpec: StateSectionSpec<UnlockState> = {
  key: 'unlock',
  parse: parseUnlockState,
  defaults: () => ({ codes: [] }),
}

/** Every unlock code redeemed on this machine; the same handle on every call for one store. */
export function unlockState(state: StateStore): StateSection<UnlockState> {
  return state.section(unlockSpec)
}

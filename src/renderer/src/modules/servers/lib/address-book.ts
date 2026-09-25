import type { ConfigProfile } from '@shared/modules/config'

/**
 * Story 127 D1: pure logic for "add this server to my address book" - writing one of Quake II's
 * nine `adr0`-`adr8` cvars, which the engine's in-game address book menu reads directly, into a
 * chosen config profile. No React, no electron - this is the same shape/reasoning the address
 * validator (`@shared/servers/address.ts`) already follows: one small pure module three call sites
 * (this dialog, and whatever later deliverable reuses it) can share instead of drifting apart.
 */

/** The nine address-book cvar slots Quake II's engine understands, in order. */
export const ADDRESS_BOOK_SLOTS = [
  'adr0',
  'adr1',
  'adr2',
  'adr3',
  'adr4',
  'adr5',
  'adr6',
  'adr7',
  'adr8',
] as const

export type AddressBookSlot = (typeof ADDRESS_BOOK_SLOTS)[number]

export interface AddressBookSlotValue {
  slot: AddressBookSlot
  /** `undefined` when the cvar is absent, or present but empty/whitespace-only. */
  value: string | undefined
}

/** Reads all nine `adr0`-`adr8` values out of a profile's `cvars` map, in slot order. A missing key
 * and a blank value are both reported as `undefined` - the dialog has no reason to tell "never set"
 * apart from "set to nothing". */
export function readAddressBookSlots(cvars: Record<string, string>): AddressBookSlotValue[] {
  return ADDRESS_BOOK_SLOTS.map((slot) => {
    const raw = cvars[slot]
    const value = raw !== undefined && raw.trim().length > 0 ? raw : undefined
    return { slot, value }
  })
}

/** Which profile to preselect when the dialog opens: the active installation's default profile, or
 * else the first profile in the list. */
export function pickPreselectedProfileId(
  profiles: ConfigProfile[],
  activeInstallationId: string | null,
): string | undefined {
  if (activeInstallationId !== null) {
    const defaultProfile = profiles.find((profile) =>
      profile.assignments.some(
        (assignment) =>
          assignment.installationId === activeInstallationId && assignment.isDefault,
      ),
    )
    if (defaultProfile) return defaultProfile.id
  }
  return profiles[0]?.id
}

/** Which slot to preselect: the slot already holding this exact address wins (re-adding the same
 * server should not silently pick a different slot), else the lowest-numbered empty slot, else none
 * - every slot is occupied by something else, and the dialog leaves the choice to the user. */
export function pickPreselectedSlot(
  slots: AddressBookSlotValue[],
  address: string,
): AddressBookSlot | undefined {
  const existing = slots.find((entry) => entry.value === address)
  if (existing) return existing.slot
  const empty = slots.find((entry) => entry.value === undefined)
  return empty?.slot
}

/** Builds the new `cvars` map to write: every existing cvar untouched, plus `slot` set to `address`.
 * Returns a new object - `currentCvars` is never mutated. */
export function buildAddressBookCvars(
  currentCvars: Record<string, string>,
  slot: string,
  address: string,
): Record<string, string> {
  return { ...currentCvars, [slot]: address }
}

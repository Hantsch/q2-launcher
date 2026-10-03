import { create } from 'zustand'
import type { ConfigProfile } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { listConfigProfiles } from './client'

/**
 * The renderer's copy of main's config profile list, shared by every view of the config module
 * and outliving any one of them (story 218). It owns the list only - which profile is open stays
 * view state / the shell's route focus.
 *
 * Every action bumps a sequence counter, and `load()` applies its answer only if nothing has
 * bumped it since the request went out. Without that, a list fetched before a save could land
 * after the save's `upsert`/`replaceAll` and silently revert the edit.
 */
interface ConfigProfilesState {
  profiles: ConfigProfile[]
  /** Re-reads the list from main; the outcome is returned unchanged, a failure leaves the list. */
  load: () => Promise<Outcome<ConfigProfile[]>>
  /** Adopts a full list main returned from a mutation. */
  replaceAll: (profiles: ConfigProfile[]) => void
  /** Folds one profile main returned into the list by id, appending it when it is new. */
  upsert: (profile: ConfigProfile) => void
  remove: (id: string) => void
}

export const useConfigProfiles = create<ConfigProfilesState>((set) => {
  let sequence = 0

  return {
    profiles: [],
    load: async () => {
      const ticket = ++sequence
      const outcome = await listConfigProfiles()
      if (outcome.ok && ticket === sequence) set({ profiles: outcome.value })
      return outcome
    },
    replaceAll: (profiles) => {
      sequence++
      set({ profiles })
    },
    upsert: (profile) => {
      sequence++
      set((s) => ({
        profiles: s.profiles.some((p) => p.id === profile.id)
          ? s.profiles.map((p) => (p.id === profile.id ? profile : p))
          : [...s.profiles, profile],
      }))
    },
    remove: (id) => {
      sequence++
      set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) }))
    },
  }
})

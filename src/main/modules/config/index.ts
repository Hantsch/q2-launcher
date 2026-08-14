import { CONFIG_HANDLERS, type ConfigProfile } from '@shared/modules/config'
import { reconcileAssignments } from './assignments'
import { fail, ok, type Outcome } from '@shared/types'
import type { MainModule } from '../types'
import { ProfilesStore } from './profiles'
import {
  assignProfileInputSchema,
  createConfigProfileInputSchema,
  removeConfigProfileInputSchema,
  renameConfigProfileInputSchema,
  setDefaultProfileInputSchema,
  setProfileCvarsInputSchema,
  unassignProfileInputSchema,
} from './schemas'

/**
 * The config module - CRUD over centrally-owned config profiles, plus their
 * assignment links to installations.
 *
 * Mirrors `library`'s shape (see `../library/index.ts`): a `MainModule` whose
 * `setup` registers handlers on the shell's `module:invoke` channel and does
 * nothing else. Profile logic itself lives in `ProfilesStore`; this file only
 * wires payload validation to it and shapes the return values.
 *
 * No `emit` here - the renderer reloads from each mutation's returned list,
 * there is no broadcast event for this module in step 1.
 */
export const configModule: MainModule = {
  id: 'config',

  setup({ handle, app, log }) {
    const profiles = new ProfilesStore(app.state)

    // One-off sweep: drop assignments to installations that vanished while the
    // launcher was closed, so a stale reference never reaches the renderer.
    profiles.reconcile(app.installations.list().map((installation) => installation.id))

    // Every handler below re-filters against the *live* installation set on
    // read, so an installation removed mid-session (no restart, no reconcile
    // sweep in between) never shows up in what the renderer sees - without
    // writing that removal to disk here, since this module deliberately does
    // not hook into `InstallationsService.remove()`.
    const withLiveAssignments = (list: ConfigProfile[]): ConfigProfile[] =>
      reconcileAssignments(
        list,
        app.installations.list().map((installation) => installation.id),
      )

    handle(CONFIG_HANDLERS.list, (): ConfigProfile[] => withLiveAssignments(profiles.list()))

    handle(CONFIG_HANDLERS.create, (payload): ConfigProfile[] =>
      withLiveAssignments(profiles.create(createConfigProfileInputSchema.parse(payload))),
    )

    handle(CONFIG_HANDLERS.rename, (payload): ConfigProfile[] =>
      withLiveAssignments(profiles.rename(renameConfigProfileInputSchema.parse(payload))),
    )

    handle(CONFIG_HANDLERS.remove, (payload): ConfigProfile[] =>
      withLiveAssignments(profiles.remove(removeConfigProfileInputSchema.parse(payload))),
    )

    handle(CONFIG_HANDLERS.setCvars, (payload): ConfigProfile[] =>
      withLiveAssignments(profiles.setCvars(setProfileCvarsInputSchema.parse(payload))),
    )

    handle(CONFIG_HANDLERS.assign, (payload): Outcome<ConfigProfile[]> => {
      const parsed = assignProfileInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      if (!app.installations.find(parsed.data.installationId)) {
        return fail('config.error.installationNotFound')
      }
      try {
        return ok(withLiveAssignments(profiles.assign(parsed.data)))
      } catch {
        return fail('config.error.profileNotFound')
      }
    })

    handle(CONFIG_HANDLERS.unassign, (payload): Outcome<ConfigProfile[]> => {
      const parsed = unassignProfileInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      if (!app.installations.find(parsed.data.installationId)) {
        return fail('config.error.installationNotFound')
      }
      try {
        return ok(withLiveAssignments(profiles.unassign(parsed.data)))
      } catch {
        return fail('config.error.profileNotFound')
      }
    })

    handle(CONFIG_HANDLERS.setDefault, (payload): Outcome<ConfigProfile[]> => {
      const parsed = setDefaultProfileInputSchema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      if (!app.installations.find(parsed.data.installationId)) {
        return fail('config.error.installationNotFound')
      }
      try {
        return ok(withLiveAssignments(profiles.setDefault(parsed.data)))
      } catch (error) {
        // The thrown message is the only way to tell "unknown profile" apart
        // from "profile exists but isn't assigned to that installation" -
        // `assignments.ts` throws a plain `Error` in both cases (see
        // `requireProfile` vs the not-assigned check in `setDefault`).
        const notAssigned =
          error instanceof Error && error.message.includes('is not assigned to installation')
        return fail(notAssigned ? 'config.error.notAssigned' : 'config.error.profileNotFound')
      }
    })

    log.debug('config module ready')
  },
}

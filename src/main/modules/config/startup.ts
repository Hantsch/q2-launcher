import type { Logger } from '../../lib/logger'
import type { configState } from './persisted'
import type { ProfilesStore } from './profiles'
import type { ProfileWrites } from './profile-writes'
import { runFileSourceStartup } from './rebuild'

export interface ConfigStartupDeps {
  profiles: ProfilesStore
  config: ReturnType<typeof configState>
  canonicalBaseDir: () => string
  syncAndPersist: ProfileWrites['syncAndPersist']
  log: Logger
}

/**
 * The module's start-of-run sequence (story 210): the file-source startup, then one retry sweep.
 *
 * `state.json` is a cache, so before the first retry sweep reads the profile list, two things
 * happen exactly once each per start:
 *
 * 1. The one-time format migration (gated by `configFileSourceMigratedAt`, so a second start is a
 *    no-op) brings every pre-existing profile's canonical file up to the current format and seeds
 *    its `fileHash`.
 * 2. Every launcher-owned `.cfg` in the canonical directory whose sentinel id `state.json` has no
 *    record for gets that record rebuilt from the file, keeping the sentinel's id.
 *
 * The file-source call is guarded: a failure of the directory scan (a permissions problem on the
 * canonical dir, say) must leave the module running on its cached state, not take the config
 * module - and with it the app's config tab - down at start. Per-profile and per-file failures
 * are already handled inside, and the migration guard stays unset on any of them so the next
 * start retries.
 *
 * The sweep retries whatever the last session left behind - a failed write (`writeFailures`).
 * One sweep only: `syncAndPersist` records a fresh failure if it fails again, and the next
 * mutation or the `write` channel are the other two retry triggers. Nothing is ever left
 * "pending" across a restart, because a running game defers nothing.
 */
export async function runConfigStartup(deps: ConfigStartupDeps): Promise<void> {
  const { profiles, config, log } = deps

  try {
    const report = await runFileSourceStartup({
      baseDir: deps.canonicalBaseDir(),
      listProfiles: () => profiles.list(),
      replaceProfile: (profile) => void profiles.replaceProfile(profile),
      addProfile: (profile) => void profiles.addRebuilt(profile),
      migratedAt: () => config.fileSourceMigratedAt.get(),
      setMigratedAt: (at) => void config.fileSourceMigratedAt.markDone(at),
      log,
    })
    if (report.migration !== 'skipped' || report.rebuiltProfileIds.length > 0) {
      log.info(
        `config file source: migration ${report.migration} ` +
          `(${report.migratedProfileIds.length} file(s), ${report.failedProfileIds.length} failed), ` +
          `${report.rebuiltProfileIds.length} profile(s) rebuilt from disk, ` +
          `${report.ignoredFileNames.length} owned file(s) ignored`,
      )
    }
  } catch (error) {
    log.error('config file-source startup failed; continuing on cached state', error)
  }

  const failures = config.writeFailures.get()
  const retryIds = new Set<string>()
  for (const key of Object.keys(failures)) {
    // Keys are `<profileId>|own` or `<profileId>|<installationId>`.
    const profileId = key.split('|')[0]
    if (profileId) retryIds.add(profileId)
  }

  if (retryIds.size > 0) {
    const allProfiles = profiles.list()
    for (const profileId of retryIds) {
      const profile = allProfiles.find((p) => p.id === profileId)
      // A profile id referenced by stale bookkeeping that no longer exists is simply skipped.
      // Sequentially awaited, never `Promise.all`: overlapping fs writes to the same installation
      // must not race, the same reasoning the write loops in `sync.ts` use.
      if (profile) await deps.syncAndPersist(profile, allProfiles)
    }
  }
}

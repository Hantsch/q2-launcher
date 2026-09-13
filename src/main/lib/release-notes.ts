import { app } from 'electron'
import { extractVersionSection, parseReleaseNotes } from '@shared/release-notes'
import type { ReleaseNotes } from '@shared/types'

/**
 * The installed version's release notes (story 099 AC1), resolved from the repo's own
 * `CHANGELOG.md` - the single source story 096 already publishes releases from.
 *
 * R3: the changelog enters the **bundle**, not the filesystem. This `?raw` import is inlined as a
 * string literal by Vite's asset plugin at build time, so there is no runtime file read, no
 * `extraResources` entry to keep in sync, and nothing that can be missing next to a packaged
 * `app.asar`. The relative path is deliberate: `src/main/lib` -> `src/main` -> `src` -> repo root.
 * It resolves identically in `electron-vite dev`, in `electron-vite build`'s main bundle and under
 * vitest, because all three run the same Vite resolve/load pipeline; `externalizeDepsPlugin` does
 * not touch it, since it only externalises bare specifiers listed in package.json `dependencies`.
 * `release-notes.test.ts` asserts the import really carries the changelog's text, so an empty or
 * mis-resolved inline would fail the suite rather than surface as an empty About panel.
 */
import changelogRaw from '../../../CHANGELOG.md?raw'

/**
 * The pure half: which section of `changelog` belongs to `version`, already parsed into data.
 *
 * Separated from `installedReleaseNotes()` only so it can be exercised against a multi-version
 * fixture - the bundled changelog is whatever the working tree happens to hold, which is not
 * something a test may assert release-section shapes against.
 *
 * R4: exactly one section, never a concatenation - the full history is AC3's link.
 */
export function resolveReleaseNotes(changelog: string, version: string): ReleaseNotes {
  const section = extractVersionSection(changelog, version)
  if (!section) {
    // Not an error: a dev build, a build predating published releases, or a version bump whose
    // changelog entry isn't written yet. AC5 renders this as an empty state.
    return null
  }

  return {
    version: section.version,
    date: section.date,
    sections: parseReleaseNotes(section.body),
  }
}

/** The bundled changelog text, exported for the test that guards the `?raw` import above. */
export const bundledChangelog = changelogRaw

/** `resolveReleaseNotes` applied to the bundled changelog and the running app's own version. */
export function installedReleaseNotes(): ReleaseNotes {
  return resolveReleaseNotes(changelogRaw, app.getVersion())
}

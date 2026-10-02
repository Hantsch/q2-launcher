import type { DetectedRetailSource } from '@shared/modules/downloads'
import type { UiHarness, UiHarnessVar } from '../../lib/ui-harness'

/**
 * Story 088 D2: the env var a UI-verification flow names its fixture Steam/GOG/Epic sources in -
 * JSON-encoded `DetectedRetailSource[]`. Only read under the same double gate as
 * `resolveDownloadSource` (`services/content/source.ts`); see that function's doc comment in `services/content/source.ts` for why this backdoor has to exist
 * at all (Playwright cannot plant a real Steam library, and `listDetectedRetailSources`'s only
 * outside dependency is the detection module seam).
 */
export const HARNESS_STORE_SOURCES_ENV = 'Q2L_UI_HARNESS_STORE_SOURCES' satisfies UiHarnessVar

/**
 * The fixture `DetectedRetailSource[]` a harness-launched wizard should offer instead of the real
 * detection scan, or `undefined` when there is none to use:
 *
 *  - the double gate is closed, or open with the variable unset/empty/malformed JSON/not an array -
 *    all fall back to `undefined` rather than to `[]`, the same "closed and 'no override' both mean
 *    'run the real thing'" convention `uiHarnessPickedFolders` (`../../lib/ui-harness.ts`) uses. A
 *    caller distinguishes "no override" from "the harness says there are zero sources" by whether
 *    the *env var itself* is set to `'[]'`, not by this function's own return type.
 *  - both gates open and the variable holds a valid JSON array: that array, verbatim - the array's
 *    contents are not re-validated against `DetectedRetailSource`'s shape here, since this is a
 *    developer- and test-authored fixture, not renderer-supplied input.
 */
export function resolveDetectedRetailSourcesOverride(
  harness: UiHarness,
): DetectedRetailSource[] | undefined {
  const raw = harness.read(HARNESS_STORE_SOURCES_ENV)
  if (raw === undefined || raw.length === 0) return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DetectedRetailSource[]) : undefined
  } catch {
    return undefined
  }
}

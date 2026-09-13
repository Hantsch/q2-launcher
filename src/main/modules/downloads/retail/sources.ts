import type { DetectedRetailSource } from '@shared/modules/downloads'
import type { AppContext } from '../../../context'
import { listDetectedRetailSources } from '../bootstrap/retail-source'
import { resolveDetectedRetailSourcesOverride } from '../harness'

/**
 * Story 090 D1: the one store-source lister every caller in this module uses - [[088]]'s detected
 * Steam/GOG/Epic sources (`bootstrap.retailSources`'s handler, `main/modules/downloads/index.ts`)
 * and this story's own `retail.upgradeStart` verification (D2). Lifted out of `index.ts` rather than
 * left as that file's private helper, and **not a second implementation**: this is [[088]]'s
 * `listDetectedRetailSources` behind the exact same harness-override gate the bootstrap wizard's
 * picker already used, so a source offered to one picker can never disagree with the other.
 *
 * The harness override is resolved fresh on every call (like the original), because a UI-
 * verification flow needs to change its fixture between runs within one launch - under the same
 * double gate (`Q2L_UI_HARNESS === '1' && isDev`), so a packaged build always reaches the real
 * `listDetectedRetailSources`.
 */
export function detectedRetailSourcesFor(app: AppContext): Promise<DetectedRetailSource[]> {
  const override = resolveDetectedRetailSourcesOverride({ isDev: app.isDev })
  if (override !== undefined) return Promise.resolve(override)
  return listDetectedRetailSources({ detection: app.detection })
}

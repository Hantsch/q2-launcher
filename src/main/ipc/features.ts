import type { FeatureName } from '@shared/features'
import { featuresGetUnlockedSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle } from './index'

/**
 * Story 130 D2: the read-only mirror of the process's frozen `FeatureGate` (built once at boot,
 * see `src/main/features/gate.ts`) to the renderer. No failure case - the renderer either gets the
 * list or the promise rejects on a malformed payload - so a plain `handle`, same as `app:getInfo`.
 */
export function registerFeaturesIpc(app: AppContext): void {
  handle('features:getUnlocked', featuresGetUnlockedSchema, (): FeatureName[] => {
    return app.features.unlockedFeatures()
  })
}

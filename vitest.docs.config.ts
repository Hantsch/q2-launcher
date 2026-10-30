import { configDefaults, defineConfig } from 'vitest/config'
import base from './vitest.config'

// Spread, not mergeConfig: merging would concatenate include/exclude and re-exclude the docs files.
// setupFiles is pinned here so a guard added to the base setup never applies to the docs lane.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/**/*.docs.test.ts', 'scripts/**/*.docs.test.mjs'],
    exclude: configDefaults.exclude,
    setupFiles: ['src/test-support/setup.ts'],
  },
})

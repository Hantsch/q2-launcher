import { configDefaults, defineConfig } from 'vitest/config'
import base from './vitest.config'

// Spread, not mergeConfig: merging would concatenate include/exclude and re-exclude the perf files.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/**/*.perf.test.ts'],
    exclude: configDefaults.exclude,
    fileParallelism: false,
  },
})

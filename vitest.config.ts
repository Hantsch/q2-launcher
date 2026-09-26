import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    environment: 'node',
    // .tsx tests render React components and need a DOM (story 054 D1's first one); they opt in
    // per-file with a `// @vitest-environment jsdom` docblock so plain .ts tests stay on the
    // faster `node` environment.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // Default 5000ms is too tight for a dynamic `import()` under load: on a full run (~316 files),
    // transform/import contention can push a single test's first import past it, most reliably on
    // constrained CI runners (see docs/requirements/done/111-master-sources-are-a-list-i-edit.md's
    // test log for the exact same timeout on the exact same kind of test, previously worked around
    // per-run with `--testTimeout=20000` instead of fixed here).
    testTimeout: 20_000,
  },
})

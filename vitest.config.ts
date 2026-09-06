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
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})

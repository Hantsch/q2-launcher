import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * The dev-only modules (`src/shared/dev-modules.ts`) are in `npm run dev` and `npm run build:dev`
 * (what ui:flow / ui:verify run against); `build` and `package:*` leave them out.
 */
const define = (mode: string): Record<string, string> => ({
  __Q2L_DEV_MODULES__: JSON.stringify(mode === 'development'),
})

/**
 * Three separate builds:
 *  - main     -> out/main/index.js      (Node/Electron main process, CJS)
 *  - preload  -> out/preload/index.js   (sandboxed bridge, CJS)
 *  - renderer -> out/renderer/          (React app, ESM, Vite dev server in `dev`)
 *
 * `externalizeDepsPlugin` keeps everything in package.json `dependencies`
 * external for main/preload, so electron-builder ships them from node_modules.
 * Renderer deps live in `devDependencies` because Vite bundles them.
 */
export default defineConfig(({ mode }) => ({
  main: {
    define: define(mode),
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },

  preload: {
    define: define(mode),
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },

  renderer: {
    define: define(mode),
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          cinema: resolve(__dirname, 'src/renderer/cinema.html'),
        },
      },
    },
  },
}))

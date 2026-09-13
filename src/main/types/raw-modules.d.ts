/**
 * Story 099 R3: the one ambient declaration behind the bundled changelog.
 *
 * `import text from '../../../CHANGELOG.md?raw'` is resolved by Vite's asset plugin, which inlines
 * the file's contents as a string literal at build time - in `electron-vite dev`, in the packaged
 * main bundle and under vitest alike. TypeScript knows nothing about that query suffix, so the
 * import needs a type. The renderer gets the same thing from `vite/client`, which the node
 * TS project (`tsconfig.node.json`, `types: ["node"]`) deliberately does not pull in.
 */
declare module '*.md?raw' {
  const content: string
  export default content
}

/**
 * Whether this build carries the dev-only modules. The bundler replaces `__Q2L_DEV_MODULES__`
 * (`electron.vite.config.ts`, `vitest.config.ts`): true for `npm run dev` and for any build made with
 * `Q2L_DEV_MODULES=1`, false for a release build.
 */
declare const __Q2L_DEV_MODULES__: boolean

export const DEV_MODULES: boolean = __Q2L_DEV_MODULES__

/** Modules that exist only while `DEV_MODULES` is true: not in the manifests, nav, routes or IPC. */
export const DEV_MODULE_IDS: readonly string[] = ['mods', 'assets']

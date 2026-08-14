# CLAUDE.md

Guidance for agents working in this repo.

## What this is

Q2 Launcher — an Electron app (main/preload/renderer) that manages and launches
Quake II installations around the r1q2 client. Windows-first, nothing
Windows-only by design. Status: shell + installation management work;
config/download/mods/asset modules are scaffolded but not implemented — see
[docs/ROADMAP.md](docs/ROADMAP.md).

## Language

The repo is English throughout — code, comments, commit messages, docs. The UI
is translated: user-visible strings live in
`src/renderer/src/i18n/locales/` and the main process sends i18n keys, never
prose, across IPC. Only `en` ships today.

## Stack

Electron + React 19 + TypeScript + Vite (`electron-vite`), Zustand for
renderer state, Tailwind v4 for styling, Zod for runtime validation, Vitest
for tests.

## Layout

```
src/
  shared/     contract shared by main+renderer — no node, no DOM, no electron
    ipc.ts    every IPC channel + its request/response types (single source of truth)
  main/       Electron main process (services, ipc registrars, modules)
  preload/    contextBridge surface with a channel allowlist derived from shared/ipc.ts
  renderer/   React app (components, views, modules, styles, i18n)
```

Two TS projects: `tsconfig.node.json` (main/preload/shared) and
`tsconfig.web.json` (renderer/shared). Full architecture:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Key rules

- **IPC is contract-first.** Add/change a channel in `src/shared/ipc.ts`
  first; main handlers and preload's allowlist derive from it and fail the
  build/startup if out of sync.
- **Paths from the renderer are never trusted.** Validate in main
  (`src/main/lib/schemas.ts`), never assume a renderer-supplied path is safe.
- **Adding a feature** is a module (`config`, `install`, `mods`, `assets`) —
  never edit the shell. Follow the 5-step checklist in
  [docs/ARCHITECTURE.md#adding-a-module](docs/ARCHITECTURE.md#adding-a-module).
- **No image assets in the UI** — all surfaces are CSS/inline SVG
  (`src/renderer/src/styles/`).


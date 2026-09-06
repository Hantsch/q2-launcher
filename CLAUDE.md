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
- **Paths from the renderer are never trusted.** Every invoke channel carries a
  required zod payload schema (`src/shared/ipc-schemas.ts`, primitives in
  `src/shared/schemas.ts`); never assume a renderer-supplied path is safe.
- **Adding a feature** is a module (`config`, `install`, `mods`, `assets`) —
  never edit the shell. Follow the 5-step checklist in
  [docs/ARCHITECTURE.md#adding-a-module](docs/ARCHITECTURE.md#adding-a-module).
- **No image assets in the UI** — all surfaces are CSS/inline SVG
  (`src/renderer/src/styles/`).

<!-- tech-rules:managed:start 1.0.0 -->
## House rules

These rules live in this repository as project skills, so they apply to everyone who works here —
no plugin needed. Installed and updated with `/tech-rules:setup` (plugin `tech-rules@hantsch`).

| Read before | Skill |
| --- | --- |
| any code change | `/karpathy` |
| touching `src/renderer` | `/frontend-guidelines`, `/design-tokens` |
| main / preload / renderer, IPC, `webPreferences` | `/electron-arch`, `/typed-ipc`, `/ui-verify` |

Do not edit a skill to make it fit this project. A deviation is recorded **here**, with its
reason, and wins over the skill; a deviation without a reason is a violation that has been
written down.
<!-- tech-rules:managed:end -->

## Deviations

| Skill | Deviation | Reason |
| --- | --- | --- |
| `/design-tokens` (44px touch-target floor) | Controls tab grid (`src/renderer/src/styles/controls-grid.css`) uses a 40px row height and a 30px bind-slot height. | Q2 Launcher is a desktop, mouse-and-keyboard-only Electron app with no touch input surface — see story `docs/requirements/020-controls-column-grid-redesign.md`'s Decisions section. |
| `/design-tokens` (44px touch-target floor, ≥16px input font-size) | Settings tab dense cvar rows (`src/renderer/src/modules/config/components/CvarRow.tsx`, `SettingsTab.tsx`) keep 44px as the row min-height and pointer hit area, but do not apply the ≥16px input font-size floor meant to stop iOS zoom-on-focus. | Same reason as above — a desktop, mouse-and-keyboard-only Electron app with no touch input surface has no zoom-on-focus behaviour to guard against; see `docs/requirements/021-settings-dense-rows-redesign.md`'s Decisions section. Focus-visible and non-colour status indication (changed/disabled/caveat) are kept in full. |
| `/design-tokens` (44px touch-target floor) | Titlebar utility-button row (`src/renderer/src/components/shell/TitleBar.tsx`), including the Downloads button next to Settings, uses a 32px (`size-8`) icon-only hit area. | Same reason as above — a desktop, mouse-and-keyboard-only Electron app with no touch input surface; see `docs/requirements/031-downloads-icon-next-to-settings.md`. |
| `/design-tokens` (44px touch-target floor) | `DropToggles.tsx`'s ammo/message icon toggles, used in both the Controls tab's Options cell and the Aliases tab's action cluster, use `size="sm"` (28px) IconButtons. | Same reason as above — a desktop, mouse-and-keyboard-only Electron app with no touch input surface, consistent with the dense Controls-row/Options-cell sizing already used elsewhere in the same grid; introduced by story `docs/requirements/055-drop-alias-is-a-drop-with-two-toggles.md`. |
| `/design-tokens` (44px touch-target floor) | Settings tab's per-row and per-section-header action buttons (`src/renderer/src/modules/config/SettingsTab.tsx`) use `size="sm"` (28px) IconButtons, consistent with the dense Controls-row/Options-cell sizing already used elsewhere in the same grid. | Same reason as above — a desktop, mouse-and-keyboard-only Electron app with no touch input surface; introduced by story `docs/requirements/059-settings-mirrors-the-files-sections.md`. |


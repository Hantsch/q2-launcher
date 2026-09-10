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
| `/design-tokens` (44px touch-target floor) | Raw File tab's merged path/toolbar row (`src/renderer/src/modules/config/RawFileTab.tsx`) shrinks its Open-in-editor/Reveal `IconButton`s and section-header-style `Select` from the app's usual 28px dense floor down to 24px (`size-6`/`h-6`). | Same reason as above — a desktop, mouse-and-keyboard-only Electron app with no touch input surface; story `docs/requirements/061-profile-header-is-one-row.md` D2 needed this row to fund the shared header's new line-budget floor (AC4, machine-verified by `scripts/flows/config-header-geometry.mjs`), and 28px alone did not close the gap. |
| `/design-tokens` (44px touch-target floor) | The config profile detail tab strip (`src/renderer/src/modules/config/ConfigView.tsx`) uses 26px-high tab buttons (`py-1`, and no bottom padding between them and the strip's bottom rule). | Same reason as above — a desktop, mouse-and-keyboard-only Electron app with no touch input surface; story `docs/requirements/061-profile-header-is-one-row.md` D3 made this strip shared by all seven config tabs, which only fits inside the 30-visible-editor-line floor (AC4, machine-verified by `scripts/flows/config-header-geometry.mjs`) at this density. |
| `/design-tokens` (44px touch-target floor) | The Controls category rail's per-chip grip and action-menu kebab (`src/renderer/src/modules/config/ControlsTab.tsx`, `components/ControlsCategoryMenu.tsx`) use `size="sm"` (28px) IconButtons. | Same reason as above — a desktop, mouse-and-keyboard-only Electron app with no touch input surface, consistent with the dense Controls-row/Options-cell sizing already used elsewhere in the same grid; introduced by story `docs/requirements/062-category-rail-is-clean-and-uses-an-action-menu.md`. |
| CLAUDE.md Key rules ("No image assets in the UI") | Bitmaps are allowed for installation identity only — the tile that shows an installation's icon (`InstallationTile.tsx`, on the rail/library card/action bar) and the icon-picker dialog that lets the user choose one (`SetInstallationIconDialog.tsx`, which necessarily previews the same bitmaps as swatches). Everything else in the UI stays CSS/inline SVG. | Story `docs/requirements/067-an-installation-carries-an-icon-i-choose.md` needs a real bitmap on a routine UI surface (not just the boot splash hero) to let a user tell two identically-coded installations apart, and a picker cannot let you choose an icon without showing it. |
| CLAUDE.md Key rules ("No image assets in the UI") | Feed/news slide images — the split and banner slide templates' images, served from the launcher's own image cache over `q2launcher://news-image/` — are the second place a real bitmap enters the UI, alongside the installation-icon exception above. | Story `docs/requirements/084-slide-images-come-from-the-launchers-own-cache.md`: feed images are foreign content — downloaded from the news feed's own source at runtime, never a shipped/bundled asset — the same class of reasoning as the installation-icon row, but a distinct case (foreign downloaded content vs. a user-chosen local bitmap), so it gets its own row rather than being merged into that one. |


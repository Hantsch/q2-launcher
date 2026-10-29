# CLAUDE.md

Guidance for agents working in this repo.

## What this is

Q2 Launcher — an Electron app (main/preload/renderer) that manages and launches
Quake II installations around the r1q2 client. Windows-first, nothing
Windows-only by design. Status: v0.6.0 ships installations, config profiles, downloads, servers,
replays and mods installs; what is next lives in
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
- **Adding a feature** is a module (`home`, `library`, `config`, `downloads`, `mods`, `servers`, `replays`; `assets` is planned — ids in `src/shared/types/module.ts`) —
  never edit the shell. Follow the step-by-step checklist in
  [docs/ARCHITECTURE.md#adding-a-module](docs/ARCHITECTURE.md#adding-a-module).
- **No image assets in the UI** — all surfaces are CSS/inline SVG
  (`src/renderer/src/styles/`).
- **Platform parity is explicit.** The app supports **Windows and Linux**, Windows first (~80% of
  users). A feature that cannot work on the current platform is **never silently omitted there**:
  the control stays visible, is disabled, and carries the reason as **visible text** ("Not available
  on Linux: …") — not only a tooltip. The reason is an i18n key like every other label, and the
  unavailability plus its reason are part of the feature's spec, not an implementation detail.

- **The changelog tells users what is new — short, not a story.** `CHANGELOG.md` is read by users
  (it is baked into Settings > About). One line per user-visible feature or fix, no more than ~15
  words of detail. A feature is one entry, not one per story: refinements, polish and fixes of
  something still under `## Unreleased` are folded into its entry, never listed separately. No
  internals, no "where did this come from" explanations. A release section should fit on one screen.
- **A release needs a green `ci` run on its SHA.** The release `plan` job refuses otherwise, also right after a merge while `ci` still runs (dispatch release again once green); `skip_ci_guard` overrides and is logged; dry runs are not guarded.
- **Layering is enforced, not conventional.** `shared/` is pure, the renderer imports no node/electron,
  modules don't import each other, and the shell doesn't import module internals — enforced by
  `src/architecture.test.ts` and `npm run lint`. An exception is an allowlist entry with a story number.

<!-- tech-rules:managed:start 2.4.0 -->

## House rules

These rules live in this repository as project skills, so they apply to everyone who works here —
no plugin needed. Installed and updated with `/tech-rules:setup` (plugin `tech-rules@hantsch`).

| Read before                                                       | Skill                                        |
| ----------------------------------------------------------------- | -------------------------------------------- |
| any code change                                                   | `/karpathy`                                  |
| writing or moving a test, touching a test config or a CI workflow | `/test-gates`                                |
| touching `src/renderer`                                           | `/renderer-guidelines`, `/design-tokens`     |
| main / preload / renderer, IPC, `webPreferences`                  | `/electron-arch`, `/typed-ipc`, `/ui-verify` |

`/test-review` reviews the test suite and writes a report; `/release-prep` runs every test lane
before a release. Which command is which lane is this project's `## Test lanes` table.

Do not edit a skill to make it fit this project. A deviation is recorded **here**, with its
reason, and wins over the skill — one row per rule deviated from, listing the places, never one
row per control; a deviation without a reason is a violation that has been written down.
<!-- tech-rules:managed:end -->

## Test lanes

| Lane         | Trigger                                                            | Command                                                                         | OS                  | Blocks                                                                 |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| pr-unit      | PR into main, push to main (`ci.yml`)                              | format, typecheck, lint, unit tests, audit; `linux-journey` job                 | Windows, Linux      | Yes for `test` incl. Audit; `linux-journey` is advisory                |
| pr-ui        | PR into main (`ui-flows.yml`)                                      | `windows-verify`: `ui:verify` + 8 core-journey flows (`ui:flow -- <name>` each) | Windows             | Yes for `windows-verify`; the sharded Linux `ui-flows` job is advisory |
| release      | push to main, manual (`release.yml`)                               | `ci-guard` in `plan`, `build-linux`, `release`, packaged launch smoke           | Linux, Windows      | Yes; the packaged smoke is non-blocking for the first 2 releases       |
| release-prep | local, before a release                                            | `npm run verify:release`, `npm run rehearse`                                    | Windows host + act  | Maintainer's call; nothing enforces it                                 |
| sprint gate  | local, after the last story of a sprint                            | `npm run ui:flows` (full), `npm run ui:flows -- --tier=smoke`                   | Windows             | Blocks the sprint review                                               |
| perf         | manual (`perf.yml`)                                                | `npm run test:perf`                                                             | Windows             | No                                                                     |
| linux        | manual, additional target (`linux-verify.yml`, `linux-update.yml`) | `npm run ci:local:verify` and the other `ci:local:*` scripts                    | Linux (act, Docker) | No                                                                     |

Linux is an additional target: its checks are run by hand and never gate a PR or release. Linux
jobs that still trigger on GitHub (`linux-verify.yml`, `linux-update.yml`, `linux-journey`, the
`ui-flows.yml` Linux job) are advisory only. The maintainer owns any change to that policy.

**e2e** means both `npm run ui:verify` (screenshots + axe report) and `npm run ui:flows` (journey
flows; sharded in CI, `--affected` per story, full at the sprint gate).

## Deviations

| Skill                                             | Deviation                                                                                                                                                                                                                                                                                                                                                          | Reason                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/design-tokens` (44px touch-target floor)        | One deviation for the whole app: dense controls use a 28px (`size="sm"`) floor and in-row selects/toolbar controls a 24px floor instead of 44px; the Controls grid uses 40px rows and 30px bind slots, the dashboard grid 40px rows, the titlebar utility buttons 32px. Anything below 24px needs its own row.                                                     | Q2 Launcher is a desktop, mouse-and-keyboard-only Electron app with no touch input surface.                                                                                                                                                                                                                                                                                                                         |
| `/design-tokens` (≥16px input font-size)          | Settings tab dense cvar rows (`src/renderer/src/modules/config/components/CvarRow.tsx`, `SettingsTab.tsx`) do not apply the ≥16px input font-size floor meant to stop iOS zoom-on-focus. Focus-visible and non-colour status indication are kept in full.                                                                                                          | A desktop, mouse-and-keyboard-only Electron app has no zoom-on-focus behaviour to guard against; see `docs/requirements/021-settings-dense-rows-redesign.md`.                                                                                                                                                                                                                                                       |
| CLAUDE.md Key rules ("No image assets in the UI") | Bitmaps are allowed for installation identity only — the tile that shows an installation's icon (`InstallationTile.tsx`, on the rail/library card/action bar) and the icon-picker dialog that lets the user choose one (`SetInstallationIconDialog.tsx`, which necessarily previews the same bitmaps as swatches). Everything else in the UI stays CSS/inline SVG. | Story `docs/requirements/067-an-installation-carries-an-icon-i-choose.md` needs a real bitmap on a routine UI surface (not just the boot splash hero) to let a user tell two identically-coded installations apart, and a picker cannot let you choose an icon without showing it.                                                                                                                                  |
| CLAUDE.md Key rules ("No image assets in the UI") | Feed/news slide images — the split, banner and cover slide templates' images, served from the launcher's own image cache over `q2launcher://news-image/` — are the second place a real bitmap enters the UI, alongside the installation-icon exception above.                                                                                                      | Story `docs/requirements/084-slide-images-come-from-the-launchers-own-cache.md`: feed images are foreign content — downloaded from the news feed's own source at runtime, never a shipped/bundled asset — the same class of reasoning as the installation-icon row, but a distinct case (foreign downloaded content vs. a user-chosen local bitmap), so it gets its own row rather than being merged into that one. |
| `/test-gates` (perf lane)                         | The perf lane (`npm run test:perf`, `perf.yml`) runs on manual dispatch only, not as an advisory PR job, and a budget overrun fails the run instead of warning.                                                                                                                                                                                                    | The maintainer made the lane manual-only (story 267); a manual run is read by its exit code and blocks no merge or release.                                                                                                                                                                                                                                                                                         |

Sub-28px cases under the 44px row above:

- Raw File tab toolbar (`RawFileTab.tsx`): 24px icon buttons and section select.
- Config profile tab strip (`ConfigView.tsx`): 26px tab buttons.
- Demo row rating select (`DemoRow.tsx`): 24px.

## Comments

A comment states an invariant or the non-obvious why — never what the next line does. A story
pointer is allowed only as a trailing `(story 052)`; review-round narrative and
deliverable/AC ids never go in code.

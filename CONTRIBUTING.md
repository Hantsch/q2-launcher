# Contributing

Everything a developer needs to build, run and extend Q2 Launcher. For what the
app is and does, see [README.md](README.md).

## Stack

Electron + React 19 + TypeScript + Vite (`electron-vite`), Zustand for renderer
state, Tailwind v4 for styling, Zod for runtime validation, Vitest for tests.

## Getting started

```bash
npm install
npm run dev
```

Requires Node 22+. `npm install` downloads an Electron binary (~100 MB) on first
run.

### Scripts

| script                | what it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `npm run dev`         | Vite dev server + Electron, with hot reload                         |
| `npm run build`       | builds main, preload and renderer into `out/`                       |
| `npm start`           | runs the built output without packaging                             |
| `npm run typecheck`   | `tsc -b` over both TS projects                                      |
| `npm test`            | Vitest unit tests                                                   |
| `npm run format`      | Prettier                                                            |
| `npm run icon`        | regenerates `build/icon.{png,ico}` from `scripts/generate-icon.mjs` |
| `npm run package:win` | typecheck, build, then an NSIS installer + zip in `release/`        |

### Rehearsing CI locally

The three workflows that run on Linux can each be run here through
[act](https://github.com/nektos/act) (`.actrc` pins the runner image and the
`ubuntu-latest` matrix leg):

| script                  | workflow                              |
| ----------------------- | ------------------------------------- |
| `npm run ci:local`      | `ci.yml` — unit tests + user journey  |
| `npm run ci:local:verify` | `linux-verify.yml` — packaged AppImage, screenshots, axe-core |
| `npm run ci:local:update` | `linux-update.yml` — the AppImage self-update e2e |
| `npm run ci:local:all`  | all three, in that order              |

The two AppImage workflows pass `--container-options --privileged`: an AppImage
mounts itself through FUSE, which a default container cannot do. `--device
/dev/fuse --cap-add SYS_ADMIN` would be the narrower grant, but act mangles
`--device` on the way to Docker (`device access at 16 field cannot be empty`),
so `--privileged` is what actually works. It applies to the throwaway act
container only — no workflow asks GitHub's runner for it.

**How far each one actually gets, measured rather than assumed.**
`ci:local` runs `ci.yml` green end to end. `ci:local:verify` gets through
packaging the AppImage and then fails to *launch* it (`Process failed to
launch!`) — `/dev/fuse` and the fuse filesystem are both present in the
privileged container, so the cause is something else about act's environment
and is still unidentified. Until it is, the packaged-AppImage workflows can be
rehearsed in a plain container instead: unpack a clean `git archive` of HEAD
into an image that has Electron's runtime libraries plus `xvfb` and `libfuse2`,
and run the workflow's own commands. That route does complete, and is what
found the four bugs behind the failing CI runs of 2026-09-22.

Two things these runs still cannot tell you, both of which have produced a
green local run over a red CI one before:

- act copies your **working tree**, not the commit (`.actrc`'s
  `--use-gitignore=false`), so untracked and ignored files are present here and
  absent on GitHub.
- your machine is faster, and its locale is probably not the runner's. Two
  tests currently fail on a German Windows and pass on CI, because
  `formatRelativeTime()` renders in the system locale.

ESLint is deliberately absent: `typescript-eslint@8` caps TypeScript at
`<6.1.0` and this project is on TypeScript 7, so the two cannot be installed
together. `tsc -b` plus Prettier covers the gap.

## Layout

```
src/
  shared/          contract shared by all three processes - no node, no DOM
    ipc.ts         every channel, its request and its response type
    types/         domain model (installation, engine, job, module, settings)
    modules/       one contract file per module
  main/            Electron main process
    ipc/           one registrar per domain, all typed against shared/ipc.ts
    services/      installations, inspector, detection, launch, jobs, state
    modules/       main-process half of each module + the registry
  preload/         the single contextBridge surface, with a channel allowlist
  renderer/src/    React app
    components/    shell/, ui/, installations/
    views/         one per route
    modules/       renderer half of each module + the registry
    styles/        design tokens and the signature surfaces
    i18n/          locale bundles - all user-visible text lives here
```

Two TypeScript projects: `tsconfig.node.json` (main, preload, shared) and
`tsconfig.web.json` (renderer, shared). `src/shared` is compiled into both, which
is why nothing in it may import `node:*`, `electron` or touch the DOM.

Full architecture — process model, IPC contract, state, the installation domain,
launching, jobs:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Key rules

- **IPC is contract-first.** Add or change a channel in `src/shared/ipc.ts`
  first; main handlers and preload's allowlist derive from it and fail the
  build or startup if out of sync.
- **Paths from the renderer are never trusted.** Every invoke channel carries a
  required zod payload schema (`src/shared/ipc-schemas.ts`, primitives in
  `src/shared/schemas.ts`).
- **Adding a feature is a module** (`config`, `install`, `mods`, `assets`) —
  never edit the shell. Five-step checklist:
  [docs/ARCHITECTURE.md#adding-a-module](docs/ARCHITECTURE.md#adding-a-module).
- **No image assets in the UI** — every surface is CSS or inline SVG.

## Language

The repository is English throughout — code, comments, commits, docs. The UI is
translated: user-visible strings live in `src/renderer/src/i18n/locales/`, and
the main process sends i18n keys rather than prose across IPC. Only `en` ships
today.

## Design system

Dark industrial steel, the amber of the Quake II logo as the one accent, Strogg
green for status and telemetry. Condensed uppercase display type (Oswald), Inter
for reading, JetBrains Mono for paths and numbers.

There are no image assets. Every surface — the app backdrop, the panels, the
rivets, the hazard stripes, the key-art stage — is CSS and inline SVG, and the
app icon is generated by a committed script.

Tokens live in a Tailwind v4 `@theme` block in
[`src/renderer/src/styles/`](src/renderer/src/styles/); never write a hex value
or a raw palette class in a component. Layering rules, the portal/anchoring
mechanics and how to compute styles under the production CSP:
[docs/ARCHITECTURE.md#design-system](docs/ARCHITECTURE.md#design-system).

## Security posture

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The renderer
can reach exactly the channels listed in `src/shared/ipc.ts` and nothing else —
the preload bridge enforces that allowlist at runtime, and every channel carries
a required payload schema. The production renderer is served over a privileged
`q2launcher://` scheme with a strict Content-Security-Policy on every response.
Navigation and popups are blocked, permission requests are denied, and paths
coming from the renderer are validated in main rather than trusted.

## UI verification

A committed Playwright/`_electron` harness drives the built app and produces a
screenshot per screen plus an axe-core accessibility report, so a change can be
checked without starting the app by hand:
[docs/UI-VERIFICATION.md](docs/UI-VERIFICATION.md).

## Docs and process

- **Where we stand, what is next** → [docs/ROADMAP.md](docs/ROADMAP.md) (the one
  status source).
- **Map of everything in `docs/`** → [docs/README.md](docs/README.md).
- **How a finished system works** → [docs/systems/](docs/systems/).
- **Working conventions for agents, and the recorded deviations from the house
  rules** → [CLAUDE.md](CLAUDE.md).
- **The changelog is written as you go** — whoever makes a user-facing change adds
  its `CHANGELOG.md` entry under `## Unreleased` in the same change, while it's
  still fresh. The release process only promotes what's already there; it doesn't
  write notes for you.

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

### Before a PR into main: `npm run verify:release`

One command that answers "will the PR checks go green, and will the release
run after the merge?" (`scripts/verify-release.mjs`). It needs Docker running
and [act](https://github.com/nektos/act) on the PATH (Windows:
`winget install nektos.act`).

It verifies what GitHub will actually run on: the **merge of your branch into
`origin/main`** (a PR's checks never run on the branch alone), taken from your
working tree as `git add -A` would commit it, checked out into clean snapshot
folders under the system temp dir — no `node_modules`, no ignored files, no
branch or index of yours touched. Then:

| step | mirrors |
| ---- | ------- |
| release plan (`release.mjs --print-plan`) | `release.yml`'s `plan` job — refuses on an empty `## Unreleased` or an existing tag |
| npm ci, typecheck, test, `ui:verify`, `package:win` | `ci.yml`'s Windows leg, `linux-verify.yml`'s axe gate, `release.yml`'s Windows build |
| act: `ci.yml`, `linux-verify.yml`, `linux-update.yml` | every Linux PR check, one job at a time |

It prints a pass/fail line per step and exits non-zero if any failed. If it
warns about uncommitted changes, commit exactly those before opening the PR.
act and Docker are checked before anything else, so a missing prerequisite
fails in seconds; act is also found in winget's install folder when a shell
predates the install. Stale `act-*` containers from an aborted run are removed
before the Linux phase.

Run it by hand, once `dev` holds everything you want to release — pushes to
`dev` are not gated. The result is only valid for the tree it verified: commit
anything after it, or let `main` move on (e.g. a `release: x.y.z` commit), and
run it again before the PR. And let the PR's checks finish before merging (PRs
#9 and #10 were merged ~30 s after the push, before any check had run).

A trap it catches that no branch-only check can: after a release, `main` has a
`release: x.y.z` commit that promoted `## Unreleased` into a version section.
If your branch does not contain that commit, git's merge can silently file your
new changelog entries under the *released* version, leaving `## Unreleased`
empty — and the release job on `main` refuses. Merge `main` into your branch
and put the entries back under `## Unreleased`.

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
The `Process failed to launch!` that used to stop every Electron launch under
act was a missing `libgtk-3.so.0`: `playwright install-deps chromium` installs
headless Chromium's libraries, which do not include GTK, and GitHub's runner
merely happens to preinstall it. The workflows now install `libgtk-3-0t64`
explicitly. Run act jobs one at a time (`--concurrent-jobs 1`, as
`verify:release` does): parallel jobs race on act's shared Node tool cache,
and the loser falls back to the image's npm 11, whose `npm ci` rejects this
lockfile. And give the container a real `/dev/shm` (`--shm-size=2g`): with
Docker's 64 MB default the renderer crashes on the news-image screens
(`Target crashed`, `Unable to capture screenshot`).

Things the `ci:local*` scripts cannot tell you (`verify:release` handles the
first two), each of which has produced a green local run over a red CI one:

- they run your branch, but a PR's checks run on its **merge into main**.
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

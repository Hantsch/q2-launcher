# UI verification harness

## What this is, and why

Every story with a visible surface used to end the same way: green build, green
tests, and then "live acceptance pending", because nobody actually drove the
Electron window — the sandbox most sessions run in has no display. This
harness closes that gap without requiring a human (or a session) to start the
app by hand: one command builds the app if needed, launches it under
Playwright's Electron driver against a generated fixture, walks every screen,
and leaves behind a screenshot and an axe-core accessibility report per
screen. It is evidence for manual review, not a business-logic test suite —
`npm test` still owns that.

It is plain `.mjs` scripts under `scripts/`, deliberately outside both
TypeScript projects (`tsconfig.node.json`, `tsconfig.web.json`) — see
`docs/requirements/026-ui-verification-harness.md` for why this shape was
chosen over Playwright test files under a project config.

## The one command

```
npm run ui:verify
```

Runs `scripts/ui-verify.mjs`, which in order:

1. Builds the app (`npm run build`) if `out/main/index.js` or
   `out/renderer/index.html` is missing.
2. Seeds the fixture (same writer as `npm run ui:seed`) for any variant that
   isn't already on disk.
3. Runs `scripts/shot.mjs` (screenshots) as a child process.
4. Runs `scripts/a11y.mjs` (accessibility report) as a child process.
5. Prints one combined summary and exits with the combined code (see Exit
   codes below).

It is not referenced by `npm test` or `npm run build` — it is only ever
invoked explicitly, by a person or a build session.

## The individual scripts

Run these standalone when you only need part of the pipeline:

- `npm run ui:seed` — regenerates the `populated` and `empty` fixtures
  (`.ui-verify/fixture/`). Idempotent: same literal data every time, so
  re-running it produces byte-identical files. Run it after changing the
  fixture shape in `scripts/lib/fixture.mjs`.
- `npm run ui:shot` — screenshots every screen in the registry at every
  configured viewport. Seeds the fixture itself if it's missing. Run it after
  a UI change you want to eyeball across all screens.
- `npm run ui:a11y` — runs axe-core over every screen in the registry. Also
  self-seeds. Run it when you only care about accessibility findings, not
  fresh screenshots.
- `npm run ui:flow -- <name>` — runs one named, free-form interaction script
  (`scripts/flows/<name>.mjs`) instead of the fixed registry. Run it to smoke
  a specific story's click-through path (e.g. `npm run ui:flow --
  open-keycap-dialog`).

## Where output lands

Everything lives under `.ui-verify/` at the repo root, which is gitignored
(one entry: `.ui-verify/`):

- `.ui-verify/screenshots/<id>@<width>x<height>.png` — one PNG per registry
  screen per viewport (e.g. `home@1280x800.png`). Flow screenshots land under
  `.ui-verify/screenshots/flows/<flow>-<label>.png`.
- `.ui-verify/a11y.json` — raw axe-core violations per screen.
- `.ui-verify/a11y.md` — the same findings, grouped by impact
  (critical/serious/moderate/minor), with a summary table and a rule/help-link
  table per impact — readable without opening the JSON.
- `.ui-verify/run.json` — `scripts/shot.mjs`'s machine-readable result per
  screen (`written` / `unreachable` / `error`, plus any console/page errors).
- `.ui-verify/fixture/` — the generated fixtures: `populated/userdata/` and
  `empty/userdata/` (each a `state.json` + `window-state.json`), plus
  `game/<install-id>/baseq2/` fake install trees. This is never your real
  `%APPDATA%` state — see Isolation below.

## Exit codes

Each script defines its own rule; they are not identical:

- **`ui:shot`** — `0` only if every screen in the registry was written at
  every viewport with zero console errors, zero uncaught renderer exceptions
  and no main-process crash. `1` otherwise (a screen reported `unreachable` or
  `error` in `run.json` — e.g. a missing testid, a renderer console error, or
  the harness itself failing to launch the app).
- **`ui:a11y`** — `1` if any screen was unreachable or errored (the app/harness
  itself failed for that screen, so axe never got to run on it — this takes
  priority and is checked first). Otherwise `2` if any violation anywhere has
  impact `serious` or `critical`. Otherwise `0` (clean, or only
  `minor`/`moderate` findings present).
- **`ui:verify`** — combines the two stages: `1` if the build failed, or if
  either `ui:shot` or `ui:a11y` itself exited `1` (a harness/app-level
  failure — reported and takes priority). Otherwise `2` if the `ui:a11y` stage
  exited `2` (serious/critical accessibility findings). Otherwise `0`.

`ui:flow` exits `0` on success, `1` if a step throws (naming the flow and the
step it failed at) or if the named flow file doesn't exist.

## The `ELECTRON_RUN_AS_NODE` note

This repo is often developed from a terminal hosted inside an Electron app,
which exports `ELECTRON_RUN_AS_NODE=1` in its own environment. If that
variable is inherited by a child process, `electron.exe` boots as plain
Node.js instead of Electron, and the main process dies on its very first
`require('electron')` — with a confusing stack trace, not an obvious message.

You do not need to do anything about this yourself. `scripts/lib/harness.mjs`
(`childEnv()`) always launches the app with a copy of `process.env` that has
`ELECTRON_RUN_AS_NODE` deleted (case-insensitively, since Windows environment
names are case-insensitive but `delete` is case-sensitive), regardless of what
your own shell has set. Every harness script goes through this, so it applies
to `ui:seed`, `ui:shot`, `ui:a11y`, `ui:verify` and `ui:flow` alike.

## Isolation from your real app state

A run never touches your real `%APPDATA%` state, installations or config
profiles. The app is always launched with an explicit
`--user-data-dir=.ui-verify/fixture/<variant>/userdata`, and
`scripts/lib/harness.mjs` refuses to launch — and refuses to keep running —
unless the userData path Electron itself reports (via
`app.getPath('userData')`, asked after launch rather than assumed from the
argument) is a strict descendant of `.ui-verify/` (`assertInside()` in
`scripts/lib/paths.mjs`). Since `stateFilePath()` derives from
`app.getPath('userData')` (`src/main/lib/paths.ts`), that one guard is enough
to keep a run's `state.json` and `window-state.json` inside `.ui-verify/`, and
it also gives the run its own single-instance lock so your real launcher can
stay open at the same time.

The harness also never triggers `detection:scan` — that IPC path shells out to
`reg.exe` and scans your real Steam/GOG directories
(`src/main/services/detection/providers.ts`). The seeded fixtures set
`settings.scanOnFirstRun: false` explicitly so the zero-installation `empty`
variant doesn't pop `DetectDialog` with `autoStart: true` and call it anyway.

## How to add a screen to the registry

Screens live in `scripts/lib/screens.mjs`, as a flat array `SCREENS` of
`{ id, variant, viewports, navigate }` entries. Here is a real one:

```js
{
  id: 'config-settings',
  variant: 'populated',
  viewports: BOTH_VIEWPORTS,
  navigate: configDetail('settings'),
},
```

- **`id`** — a short kebab-case name. It becomes part of every output
  filename for this screen (`config-settings@1280x800.png`, its key in
  `run.json`/`a11y.json`), so keep it unique and stable.
- **`variant`** — which seeded fixture to launch against: `'populated'` (two
  installations, three config profiles) or `'empty'` (defaults only, zero
  installations/profiles). Add a screen with `variant: 'empty'` when you need
  to capture an empty-state UI.
- **`viewports`** — an array of `{ width, height }` to shoot this screen at.
  Use the shared `BOTH_VIEWPORTS` constant (`VIEWPORT_DEFAULT` 1280x800 and
  `VIEWPORT_MIN` 940x620, mirroring `WINDOW_DEFAULT_*`/`WINDOW_MIN_*` in
  `src/shared/constants.ts`) unless the screen only makes sense at one size.
- **`navigate(page)`** — an async function that starts from the app's default
  landing route and performs whatever clicks are needed to reach this screen.
  There is no URL to navigate to (`route` is Zustand state, not a browser
  route), so this is always clicks against `data-testid`s or, where no
  testid exists, `getByRole(...).click(...)`. `config-settings` above reuses
  the shared `configDetail('settings')` helper, which opens the config list,
  selects the `Plain Profile` fixture row, and clicks the `settings` tab.

To add your own: pick an `id`, decide `populated` or `empty`, write a
`navigate` that clicks real `data-testid`s (add one to the renderer component
first if it doesn't have one — see the `data-testid` conventions comment at
the top of `screens.mjs`: `nav-<moduleId>`, `config-tab-<tabId>`,
`config-profile-row`, `keycap-<keyName>`), and append the entry to `SCREENS`.
`npm run ui:shot` and `npm run ui:a11y` pick it up automatically — nothing
else needs to be wired.

## How to write a flow

Flows are for a free-form, story-shaped click-through — not a fixed registry
walk. `scripts/flow.mjs` resolves `scripts/flows/<name>.mjs`, imports its
default export and calls it with `{ page, app, shot, log, step }`:

- **`page`** — the Playwright page for the app's first window; call
  `.getByTestId(...)`, `.getByRole(...)`, `.click()`, `.fill()`, etc. on it as
  in any Playwright script.
- **`app`** — the Playwright `_electron` application handle, for
  `app.evaluate(...)` against the main process if a step needs it.
- **`shot(label)`** — screenshots the current page to
  `.ui-verify/screenshots/flows/<flow-name>-<label>.png`.
- **`log`** — the run's `RunLog` (console messages, page errors, main-process
  exit), if a step wants to inspect it directly.
- **`step(label)`** — records the current step name only, so that if anything
  throws, the failure is reported as `flow '<name>' failed at step '<label>':
  <message>` instead of a bare stack trace.

The worked example, `scripts/flows/open-keycap-dialog.mjs`, opens the
populated fixture, goes to Config, opens a profile, switches to Overview,
turns on edit mode, opens a keycap, asserts the `KeyBindDialog` is visible,
and screenshots it:

```js
export default async function openKeycapDialog({ page, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })

  step('select profile')
  await page.getByTestId('config-profile-row').first().click({ timeout: CLICK_TIMEOUT_MS })

  step('open overview tab')
  await page.getByTestId('config-tab-overview').click({ timeout: CLICK_TIMEOUT_MS })

  step('enable edit mode')
  await page.getByRole('button', { name: 'Start editing' }).click({ timeout: CLICK_TIMEOUT_MS })

  step('open keycap dialog')
  await page.getByTestId('keycap-MOUSE1').click({ timeout: CLICK_TIMEOUT_MS })

  step('assert dialog open')
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })

  await shot('dialog-open')
}
```

To write your own: create `scripts/flows/<name>.mjs` with a default export
`async function({ page, app, shot, log, step })`, call `step(...)` before each
meaningful action, drive `page` the same way the example does, and call
`shot(...)` wherever you want evidence saved. Run it with
`npm run ui:flow -- <name>`. The flow always launches against the `populated`
fixture at the default 1280x800 viewport (`scripts/flow.mjs`) — flows aren't
part of the registry and don't take a `variant`/`viewports` of their own.

## Baselines and CI

Screenshots are **never diffed** against a committed reference, and this is
deliberate, not a gap to fill in later: a pixel baseline rots on every design
change and turns into noise nobody trusts. They exist purely as evidence for
a human to look at during manual review.

**CI is out of scope for this harness.** It is local-only for now — there is
no GitHub Actions job (or equivalent) that runs `ui:verify`, and adding one is
a decision for a future story, not an implicit consequence of this one.

## Known issues

On a clean checkout, `npm run ui:shot` / `npm run ui:a11y` / `npm run
ui:verify` currently exit non-zero because of the `config-raw` screen: it
surfaces a pre-existing renderer bug (an `Outcome` unwrap crash in
`RawConfigPanel.tsx`) that throws a renderer exception when that screen
renders. This is a known, already-flagged finding from building this harness,
not something to fix here — it is tracked as a separate story. Don't be
surprised that the exit code isn't `0` the first time you run the harness;
every other screen still gets captured normally.

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

Runs `scripts/ui-verify.mjs`, a thin wrapper that forwards its CLI args
(including `--screens=`, see "Partial runs" below) to `scripts/verify.mjs`'s
exported `run()` **in the same process** — there is no longer a separate
child process for screenshots and another for accessibility. In order,
`run()`:

1. Builds the app (`npm run build`) if `out/main/index.js` or
   `out/renderer/index.html` is missing.
2. Resolves which screens to visit: the whole registry by default, or a
   `--screens=a,b,c` subset.
3. Groups the resolved screens by fixture variant and runs one batched
   session per variant actually needed (see "The per-variant session model"
   below) — each session reseeds its fixture fresh, launches the app once,
   and walks every non-cold-start screen belonging to that variant in that
   same running app, taking the screenshot and the axe reading for a screen
   back to back.
4. Writes `run.json` (if screenshots were captured) and `a11y.json`/`a11y.md`
   (if axe was captured), and sweeps stale screenshots — but only on a full
   run (see "Partial runs" below).
5. Prints one summary, including the real launch count, and exits with one
   exit code (see Exit codes below).

It is not referenced by `npm test` or `npm run build` — it is only ever
invoked explicitly, by a person or a build session.

## The individual scripts

Run these standalone when you only need part of the pipeline. `ui:shot`,
`ui:a11y` and `ui:verify` are all `scripts/verify.mjs` — the same driver —
invoked with different flags; none of them spawns a `shot.mjs` or `a11y.mjs`
child process, because those files were deleted in story 027 and no longer
exist.

- `npm run ui:seed` — regenerates the `populated` and `empty` fixtures
  (`.ui-verify/fixture/`) on their own, without launching the app. Idempotent:
  same literal data every time, so re-running it produces byte-identical
  files. Useful for inspecting fixture contents directly; every verify run
  reseeds its own fixture regardless (see below), so this is never a
  prerequisite for `ui:shot`/`ui:a11y`/`ui:verify`.
- `npm run ui:shot` (`node scripts/verify.mjs --skip-axe`) — screenshots every
  screen in the registry at every configured viewport, skipping the axe pass.
  Run it after a UI change you want to eyeball across all screens.
- `npm run ui:a11y` (`node scripts/verify.mjs --skip-shot`) — runs axe-core
  over every screen in the registry, skipping screenshots. Run it when you
  only care about accessibility findings, not fresh screenshots.
- `npm run ui:verify` (`node scripts/ui-verify.mjs`, which forwards to
  `scripts/verify.mjs`) — runs both passes together. Any of the three accepts
  `-- --screens=a,b,c` to restrict the run to specific screen ids.
- `npm run ui:flow -- <name>` — runs one named, free-form interaction script
  (`scripts/flows/<name>.mjs`) instead of the fixed registry. Run it to smoke
  a specific story's click-through path (e.g. `npm run ui:flow --
open-keycap-dialog`).

Every `verify.mjs` run reseeds the fixture for each variant it is about to
launch, fresh, immediately before that launch — never "only if missing". A
run can never inherit drift (a stale `lastRoute`, a flipped setting) left
behind by a previous run.

## The per-variant session model

Story 026 shipped one Playwright `_electron.launch()` per screen per
viewport per script — 14 screens x 2 viewports x 2 scripts (`shot.mjs` +
`a11y.mjs`) = 56 launches for a full `ui:verify` run. `scripts/lib/session.mjs`
(`runVariantSession()`) replaces that with one launch per fixture _variant_
that the resolved screens actually need: the app launches once, and the
driver then walks every non-cold-start screen belonging to that variant in
that same running app, in registry order.

For each screen x viewport visit, in the same page state:

1. Reset to the base route (`nav-home`, closing any open dialog first), so
   every screen starts from the precondition its `navigate()` assumes — the
   same guarantee a fresh launch used to give it.
2. Resize the window (`resize()` in `scripts/lib/harness.mjs`) to the
   screen's viewport.
3. Run the screen's `navigate()`.
4. Take the screenshot, if `capture.shot` is on.
5. Run the axe-core scan, if `capture.axe` is on.

Steps 4 and 5 happen back to back with nothing in between, which is what
guarantees a screen's `a11y.json` entry and its PNG always describe the same
page state — story 026's two-script split could not promise that, since a
screenshot from `shot.mjs` and an axe reading from `a11y.mjs` came from two
independent app instances that could, in principle, differ.

Today's registry is 32 screens (count the `SCREENS` array in
`scripts/lib/screens.mjs` — do not carry this number forward uncounted, it
has drifted before) across 2 fixture variants (`populated`, `empty`) with no
screen marked `coldStart` (see below), so a full `ui:verify` run does **2**
`_electron.launch()` calls total — down from 56, roughly 34s instead of the
~113s story 026 measured. The actual launch count for any given run (which
changes under `--screens=`, or once a screen is marked `coldStart`) is
printed in the run summary as `launches: N`.

## Partial runs (`--screens=`)

`--screens=a,b,c` restricts a run to specific screen ids, e.g.:

```
npm run ui:verify -- --screens=home,config-settings
```

This works the same way on `ui:shot` and `ui:a11y` — all three forward their
CLI args to `verify.mjs`. An id that isn't in the registry is a hard error:
the run stops before anything is launched and the message names the bad
id(s) plus the full list of valid ones, rather than silently running a
smaller set than asked for.

A restricted run only launches the fixture variants its resolved screens
actually need — `--screens=home` (a `populated`-only screen) never touches
the `empty` fixture at all.

The one behavioral difference from a full run: **a partial run never sweeps
stale screenshots.** The sweep renames every pre-existing `.png` under
`.ui-verify/screenshots/` that the run did not (re)write to
`<name>.png.stale`. That is safe on a full run, which visits every registry
screen and can tell a genuinely stale file from one it simply had no reason
to touch. A `--screens=` run only visits a subset, so every screenshot
outside that subset would look "not written this run" and get swept even
though it is still current — so the sweep is skipped entirely whenever
`screens.length !== SCREENS.length`. The run summary says so explicitly,
e.g.:

```
run: PARTIAL — 2/22 screens (--screens=home,config-settings) — stale-PNG sweep skipped
```

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
  It also names the disabled rule(s) (see "Disabled axe rules" below), since
  `verify.mjs` prints that line into the report as well as the console
  summary.
- `.ui-verify/run.json` — `scripts/verify.mjs`'s machine-readable result per
  screen (`written` / `unreachable` / `error`, plus any console/page errors).
- `.ui-verify/fixture/` — the generated fixtures: `populated/userdata/` and
  `empty/userdata/` (each a `state.json` + `window-state.json`), plus
  `game/<install-id>/baseq2/` fake install trees. This is never your real
  `%APPDATA%` state — see Isolation below.

## Exit codes

`ui:shot`, `ui:a11y` and `ui:verify` all resolve to the same
`computeExitCode()` in `scripts/verify.mjs`, applied to whichever capture(s)
that invocation actually ran — there is one rule, not three:

- **`1`** — any visited screen's harness/app failed: unreachable (e.g. a
  missing testid), a renderer console error, an uncaught renderer exception,
  a main-process crash, or the harness itself failing to launch. Checked
  first and takes priority over any accessibility finding.
- **`2`** — no harness/app failure, but the axe-core capture found a
  violation with impact `serious` or `critical` somewhere. Only reachable
  when axe actually ran, so `ui:shot` (`--skip-axe`) can never return `2`.
- **`0`** — clean: every visited screen written/audited with no harness
  failure and, when axe ran, nothing worse than `minor`/`moderate`.

Concretely: `ui:shot` only ever exits `0` or `1`; `ui:a11y` and `ui:verify`
can exit `0`, `1` or `2`. A failed build or a bad CLI flag (an unrecognized
flag, an unknown `--screens=` id) also exits `1`, before anything is
launched.

`ui:flow` exits `0` on success, `1` if a step throws (naming the flow and the
step it failed at) or if the named flow file doesn't exist.

## Disabled axe rules

Every axe-core run disables `page-has-heading-one`, via the
`AXE_DISABLED_RULES` constant in `scripts/lib/session.mjs` (passed to
`window.axe.run()` as `AXE_RUN_OPTIONS`, built from that same constant so
there is exactly one place the exception list lives). The reason, also held
as its own exported constant (`AXE_DISABLED_RULES_REASON`) so `verify.mjs`
can print it verbatim instead of paraphrasing it: "single-window desktop app
has no page-document semantics" — the rule expects exactly one `<h1>` per
HTML document, which does not map onto an Electron shell that never has more
than one document at all. `scripts/verify.mjs` names the disabled rule and
this reason in both its console summary and `.ui-verify/a11y.md`, so a reader
never has to go looking in source to find out why a heading-level finding
never shows up.

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

## Production-mode guarantee

Story 035 made the production renderer load from a privileged custom scheme
(`q2launcher://app`) with an enforced Content-Security-Policy, instead of
`file://`. The harness proves that guarantee holds on every run rather than
trusting it by convention:

- `scripts/lib/harness.mjs` (`childEnv()`) deletes `ELECTRON_RENDERER_URL`
  from the child environment, case-insensitively, the same way it already
  deletes `ELECTRON_RUN_AS_NODE`. Without this, a developer who has that
  variable exported from working on the Vite dev server would silently flip
  a verification run back into dev-server mode — production mode has to be a
  guarantee, not a coincidence.
- Right after `waitForLoadState('domcontentloaded')`, beside the existing
  userData containment assertion, the harness asserts inside the running
  page that `location.origin` is exactly `q2launcher://app` and that
  `fetch(location.href)`'s `content-security-policy` response header is
  present and contains every entry of `REQUIRED_CSP_DIRECTIVES`:
  `script-src 'self'` and `style-src 'self';` (story 046 — the trailing `;`
  is deliberate, so a header of `style-src 'self' 'unsafe-inline'` does not
  satisfy the check by matching as a prefix). Either the origin or any
  missing directive throws a `HarnessError` naming the actual origin, or
  every missing directive together with the actual (or missing) header — not
  a generic assertion failure.
- That header check only catches a _declared_ regression. To also catch a
  `style-src 'self'` header that is still correct on paper but violated at
  runtime (e.g. a reintroduced inline `style="..."` attribute), the harness
  installs a `securitypolicyviolation` listener in the page — once
  immediately for the document already loading, and once via
  `page.addInitScript()` so it survives a mid-run `page.reload()` — and
  drains whatever it collected into `RunLog.cspViolations` before a run's
  pass/fail is read. Any collected violation shows up in `RunLog.failures`
  and `RunLog.format()` next to console errors and renderer exceptions, and
  a non-empty `cspViolations` fails the run the same way a console error
  does.

Every entry point (`ui:shot`, `ui:a11y`, `ui:verify`, `ui:flow`, and the
`node scripts/lib/harness.mjs` self-check) goes through `launchApp()`/
`childEnv()`, so all of them inherit this guarantee automatically — there is
nothing an individual script has to opt into.

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

## The importable `config.cfg` fixture

`scripts/lib/fixture.mjs` writes a fixed, deterministic `baseq2/config.cfg`
(`FIXTURE_CONFIG_CFG`) under exactly one installation's game directory —
`fixture-install-writedir` (display name "Fixture WriteDir Install"), never
under `fixture-install-favorite` or any other seeded installation. It exists
specifically to make `config-import-preview` reachable: the import dialog
needs a real, on-disk `config.cfg` to scan, and only this one installation
has one.

Its content is fixed on purpose, not randomized, so a run is byte-identical
every time (`ui:seed`'s idempotency guarantee):

- ordinary `seta` cvars (`sensitivity`, `cl_run`, `name`, `cl_particles`),
- `bind w "+forward"` followed later by `bind w "+moveup"` with no
  intervening `unbind w` — a duplicate bind, on purpose, so the import
  preview's duplicate-bind list has something to show,
- one `alias +fixture_unrecognized "echo hi"` line, which
  `config-parser.ts` does not recognize as one of
  `set`/`seta`/`setu`/`sets`/`bind`/`unbind`/`unbindall`/`exec` and therefore
  preserves verbatim — so the preview's preserved-line list also has
  something to show.

## Harness mode (`Q2L_UI_HARNESS`)

Every app instance the harness launches gets `Q2L_UI_HARNESS=1` in its
environment (`childEnv()` in `scripts/lib/harness.mjs` sets it
unconditionally, on top of the caller's own environment). `src/main/window.ts`
reads it once at module load and, only when it is exactly `'1'`, changes how
the main window is created:

- The `BrowserWindow` is constructed with `focusable: false` (Windows:
  `WS_EX_NOACTIVATE`), so it can never be activated and clicking it never
  raises it.
- The `ready-to-show` handler calls `window.showInactive()` instead of
  `window.show()`, painting the window without requesting foreground
  activation.

The effect: a verification run's window is visible — so Playwright can drive
it and take screenshots — but never steals focus from whatever the run was
started from (a terminal, an editor, another window). Outside harness mode
(`Q2L_UI_HARNESS` unset, which is every `npm run dev` and every packaged
launch) both branches are no-ops and the window behaves exactly as it always
has: shown and focused via `window.show()`.

This is not something to set by hand. It exists purely so a harness-launched
app instance can identify itself to `window.ts`; setting it on a normal
launch would only produce a launcher window that refuses to focus, with no
upside. The harness sets it automatically on every instance it launches,
whether that instance is part of a batched session or a cold-start screen's
own dedicated launch.

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

### How to add a dialog entry

A screen whose subject is a modal (`Modal`) or an inline expand-in-place
panel follows the same `{ id, variant, viewports, navigate }` shape as any
other registry entry — nothing about the harness treats a dialog specially —
but three things matter in practice:

- Put a `data-testid` on the trigger element (the button/`<select>` that
  opens the dialog or expands the panel), the same way every other screen's
  `navigate()` clicks a real testid rather than a role/text query.
- `navigate()` must wait for the dialog/panel's real content, not a loading
  spinner, before returning — the two worked examples below wait for a
  second `.cfg-code-content` block and a `.cfg-code-single` row respectively,
  specifically because both panels render a spinner first.
- Rely on the harness's own `resetToBaseState()` (`scripts/lib/session.mjs`)
  to get back to the base route afterward — never add cleanup clicks to
  `navigate()` itself. A `Modal` is closed with `Escape`; an inline panel
  (no modal, no scrim) is unmounted instead by navigating away from the
  module, since there is nothing to press Escape on.

### Two dialog/panel screens already in the registry

`scripts/lib/screens.mjs` had two such entries added by story 037 D3
(`config-import-preview`, `config-import-restore`) plus one more added by story
041 D7 (`config-import-review`); `config-write-preview` is retired as of story
057 D7 (see below). All three import-dialog entries are themselves retired as
of story 066 D8, replaced by one new entry, `config-import-files`:

- **`config-import-files`** — the import-from-files dialog inside
  `ImportProfileDialog` (`src/renderer/src/modules/config/ImportProfileDialog.tsx`),
  mid-flow: files picked and listed, before commit. Story 066 re-addressed
  import from `{ installationId, gameDir }` to a user-picked file list, so the
  dialog no longer has an installation or gamedir `<select>` at all —
  `config-import-preview`/`config-import-review`/`config-import-restore`
  above drove exactly those removed controls and could not be adapted, only
  replaced. Reached via Config list → "New profile" (`config-create-profile`)
  → source `import` (`config-create-source`) → submit (`config-create-submit`)
  → "Choose files…" (no testid, selected by its own translated accessible
  name), which triggers `DialogService`'s harness-only stub
  (`Q2L_UI_HARNESS==='1' && isDev`, `src/main/services/dialog.ts`) instead of
  a real OS dialog, handing back the three real fixture files
  `scripts/lib/fixture.mjs` stages under `.ui-verify/fixture/import-files/`
  (`dm.cfg`, `dmalias.cfg`, `gfx.cfg` — the same three files
  `docs/fixtures/` and `import-fixtures.test.ts`'s corpus test use).
  `navigate()` waits for the third `config-import-file-row` to be visible.

Story 047 D3 adds three more dialog-entry screens, following the same shape:

- **`config-controls-message`** and **`config-controls-drop-message`** —
  both open `MessageEditor`
  (`src/renderer/src/modules/config/components/MessageEditor.tsx`) from the
  Controls tab of a config profile's detail view: select the fixture action's
  category chip (no testid on the rail's category buttons, selected by
  translated accessible name — "Weapons" and "Weapon dropping" respectively),
  then click the action's edit trigger (`action-edit-<actionId>` for a plain
  action, `drop-message-edit-<catalogId>` for a drops row's "Edit message"
  trigger). Both wait for `message-editor-content` (`MessageEditor.tsx`) to
  be visible before returning, rather than any spinner, since that testid is
  on the dialog's own content container.
- **`install-detect-dialog`** — `DetectDialog`
  (`src/renderer/src/components/installations/DetectDialog.tsx`), reached via
  Library header's `library-auto-detect` button. `navigate()` waits only for
  the dialog itself (`getByRole('dialog')`) and deliberately never clicks its
  "Start" button — per Decision 2, this screen captures the pre-scan state
  only, preserving the harness's guarantee (see "Isolation from your real app
  state" above) that it never triggers a real `detection:scan`.

Story 043 D8 adds one more, and it is the first entry in the registry whose
`navigate()` reaches outside `page` entirely:

- **`config-conflict-dialog`** — `ConfigConflictDialog`
  (`src/renderer/src/modules/config/ConfigConflictDialog.tsx`), the whole-file
  save conflict dialog. Unlike every other dialog entry, its precondition
  (the profile's edits dirty in the launcher _and_ its canonical file changed
  on disk at the same time) cannot be produced by clicks alone. `navigate()`
  opens the "Plain Profile" fixture's Raw tab, toggles its "Start the file
  with `unbindall`" checkbox (`RawFileTab.tsx`) to make the profile dirty —
  a real `setWriteUnbindall` IPC round trip, not local-only state — waits for
  the Unsaved tab to appear in the strip (`config-tab-unsaved`; the
  "Unsaved changes" badge itself, `UnsavedIndicator.tsx`, sits next to the
  profile name on every tab but the raw one), then drops to the Node side and
  appends one well-formed comment line directly onto the profile's canonical
  `Plain-Profile.cfg` under the fixture's userData dir
  (`variantUserDataDir('populated')`, `scripts/lib/harness.mjs`) — the same
  "hand-edit in Notepad" the story's own acceptance criteria describe, done
  with `node:fs` rather than through `page` since the whole point is a change
  the launcher process has not read. Clicking `config-save`
  (`ProfileSaveActions.tsx`'s Save button, in the detail header's right-hand
  cluster) then hits `save`'s `changedOnDisk`
  refusal, and `navigate()` waits for `config-conflict-dialog`
  (`ConfigConflictDialog.tsx`'s two-pane content container) before returning.

Story 044 D7 adds one more, and unlike every entry above it opens no dialog or
panel at all — it flips a switch on a plain tab:

- **`config-aliases`** — the Aliases tab (`AliasesTab.tsx`) of the "Plain
  Profile" fixture's config detail view. None of that profile's five actions
  are `kind: 'alias'`, so the tab's default view (`origin: 'user'` rows only)
  would show nothing but its empty state. `navigate()` opens the tab via the
  usual `configDetail('aliases')` helper, then clicks the tab's own "Show
  generated and layer aliases" switch by its translated accessible name (no
  testid on it — `Switch`, `components/ui/controls.tsx`, links its `<label
for>` to the `role="switch"` button instead), which reveals the `generated`
  row every one of those five actions produces (`buildAliasIndex`). It waits
  for the "Generated" origin badge text rather than returning right after the
  click, since the toggle only flips local component state and nothing else
  here would fail fast if the re-render hadn't happened yet.

Story 057 D3 compacted `RawFileTab` down to one path/status line, one
file-options toolbar row and the profile's own canonical file — the
per-installation cards and `RawConfigPanel`'s only mount point were both gone
from this tab already. Story 058 D3 deleted `RawConfigPanel.tsx` outright (it
is not merely unmounted) and folds Files rows into the shared `CareItemRow`
instead of ever remounting the old panel. `config-write-preview` (story 037
D3, described above in earlier revisions of this doc) stays **retired** for
that reason: there is no click path that reaches it, and none is coming —
the view it targeted no longer exists; see the retirement comment left in
place of its old entry in `scripts/lib/screens.mjs`.

Story 057 D7 adds one more in its place, still on the Raw tab but with no
dialog or panel involved:

- **`config-raw-editing`** — Plain Profile's Raw file tab with a dirty raw
  draft: text typed into the editable code view's real `<textarea>`
  (`.cfg-code-textarea`, `ConfigCodeView.tsx`), not yet saved. `navigate()`
  opens the tab via `configDetail('raw')`, clicks into the textarea and types
  a line, then waits for the Unsaved tab to appear in the strip
  (`config-tab-unsaved`, `ConfigView.tsx`) — the profile is not dirty at that
  point, so the draft is the only thing that can put that tab there. (The
  raw-specific wording, `config.save.rawEdited`, now lives in that tab's
  content, `UnsavedChangesTab.tsx`, which this screen does not open — it is a
  shot of the raw tab.) It runs early in the registry, before any other
  `config-*` screen puts Plain Profile's _structured_ state (not this
  renderer-local draft) into a dirty state server-side — `rawEditingMode`
  requires the profile clean to allow typing at all (`lib/raw-draft.tsx`), and
  the batched `populated` session never resets in-memory profile state between
  screens (see the module-level comment in `scripts/lib/screens.mjs`).

Story 057 D3 also retargets two existing entries whose `navigate()` used to
reach the raw tab's "Section header style" control via
`page.getByLabel('Section header style')` — `config-save-expanded` and
`config-discard-confirm`. That control used to sit inside a `Field`
(`components/ui/controls.tsx`), which rendered a real `<label htmlFor>`; D3's
compacted toolbar row replaced it with a plain `<span className="stencil">`
next to the `<select>`, with no label association at all, so `getByLabel` no
longer resolves. Both now select `RawFileTab`'s one native `<select>` directly
(`page.locator('select')`) instead. `config-conflict-dialog`'s own locator (the
"Start the file with `unbindall`" checkbox, selected by its visible label text,
not `getByLabel`) was unaffected by this layout change and was left as-is.

Story 073 D6 updates one existing entry rather than adding a new one:

- **`downloads`** (added by story 031) used to land on `PlannedModuleView`, since the `downloads`
  manifest still had `status: 'planned'`. Story 073 D3 flips that to `'available'` and registers
  the real `DownloadsView`, so the same click (`nav-downloads`) now reaches real content —
  `navigate()` was given a wait on the empty-jobs body text (`downloads.jobs.empty.body`) so a
  screenshot can never race a not-yet-mounted view the way a bare click could. Per the story's own
  "Fixture split" decision, this screen only ever shows the *zero-jobs* state — a live job cannot
  be seeded through the static `state.json` fixture — which is what `variant: 'populated'` means
  here: "the real view, populated with its own UI" (the archive cache's real figure, from the two
  dummy archives `scripts/lib/fixture.mjs` seeds under `cache/downloads/`), not "populated with
  jobs". The running and failed states live in `scripts/flows/downloads-tab.mjs` instead (see
  "Flows shipped so far" below), since only a flow can trigger `dev:simulateJob`.

Story 058 D7 adds two more, for the story's own AC 9 (Care's two states) and D6's relocated
cleanup:

- **`config-care-clear`** — Care's healthy counterpart to `config-care` above (that one uses the
  findings fixture, `PROFILE_UNRECOGNIZED`; one screenshot cannot show both states — decision 11).
  Uses "Plain Profile" instead: it is assigned to an installation, in sync (the app's own startup
  retry sweep, `main/modules/config/index.ts`, writes and confirms its installation copy before the
  renderer even exists), validated with nothing worse than `info`, and free of every tidy-up finding
  `analyzeTidyUp` checks for — so `careSummary`'s `allClear` is true and the tab renders only the
  All clear block. `navigate()` waits on that block's own text
  (`config.care.summary.overall.allClear`) rather than a testid, since nothing else in the tab
  renders it.
- **`config-cleanup-dialog`** — `CleanupConfigCopiesDialog` (D6), reached from the new cleanup icon
  button on an installation row in Library rather than from Care (the redundant-copies scan left
  the profile entirely in this story). No testid on the trigger — an `IconButton` with only a
  translated `label`, same as its row-mates — so this selects it by that accessible name ("Clean up
  redundant config copies…"), and waits on the dialog's own title ("Redundant config copies") via
  `getByRole('dialog', { name })`.

### Cold-start screens

A screen normally runs inside the batched session described above: the
driver resets to the base route and resizes an already-running app into
place before calling `navigate()`. That's fine for a screen whose subject is
some _reachable_ app state, but wrong for a screen whose subject is the cold
boot itself — a splash state, first-paint layout, or anything only true in
the instant before the app has settled — because by the time the batched
session's reset/resize/navigate sequence reaches it, the app has already
booted once for an earlier screen in that variant.

Set `coldStart: true` on such an entry and `runVariantSession()` gives it its
own dedicated launch instead of folding it into the batched session: fixture
reseeded, app launched fresh, window opened straight at the screen's own
viewport (a cold-start screen is never resized after boot — resizing into it
after the fact would show a booted-then-resized window, not a boot at that
size):

```js
{
  id: 'first-launch-splash',
  variant: 'empty',
  coldStart: true,
  viewports: [VIEWPORT_DEFAULT],
  navigate: async (page) => {
    // whatever this screen needs to be visible right after boot
  },
},
```

None of the 32 screens shipped so far set `coldStart` — every current screen
is reachable from a running app via clicks, so the field exists in the
registry's shape but isn't exercised by any entry yet. Each `coldStart: true`
screen adds one extra `_electron.launch()` per viewport it lists, on top of
its variant's one batched-session launch.

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
`npm run ui:flow -- <name>`.

A flow may also export two optional lifecycle functions, added by story 074 D8
for work the flow function itself cannot do (it only runs while the app is
already up):

- `export async function setup({ variant })` — runs **before** the app is
  launched. Whatever it returns as `{ env: { … } }` is merged into the child
  environment last (`childEnv()` in `scripts/lib/harness.mjs`), which is the
  only way to hand the app a value the flow computed moments earlier — a
  fixture server's freshly bound port, say. Note that `childEnv()` deletes every
  case-insensitive spelling of each key first: Git Bash exports `PROGRAMFILES`,
  not `ProgramFiles`, and without that an override silently loses to the
  inherited entry. Anything else the flow needs afterwards it keeps in its own
  module scope; nothing is threaded back into the flow function.
- `export async function teardown()` — runs after the app is closed, pass or
  fail, so a fixture server cannot outlive the run. The flow launches at the default 1280x800
viewport (`scripts/flow.mjs`) — flows aren't part of the registry and don't
take `viewports` of their own — against the `populated` fixture unless a
second CLI argument names another variant: `npm run ui:flow -- <name>
<variant>` (story 066 D8, added so `import-from-files` could prove AC9 —
"import from files needs no installation" — against the zero-installation
`empty` variant; `variant` is also passed into the flow function's own
context object, alongside `page`/`app`/`shot`/`log`/`step`, so a flow can
tailor its own steps to whichever fixture it is actually running against).
Every flow that predates story 066 keeps its exact prior behaviour with no
argument needed.

Flows shipped so far, alongside `open-keycap-dialog` above:
`alias-rename-dialog`, `controls-category-rename-reorder`,
`controls-extra-keys`, `controls-subcategory`, `custom-action-row`,
`drop-message-checkbox`, `settings-section-rename-add-cvar`, (story 057
D7) `raw-inline-edit` — types a line into the Raw file tab's real inline
editor (`.cfg-code-textarea`), saves it via the header's `config-save`
button (the same path Ctrl+S in the editor calls), then asserts both the
read-back result panel (`config-raw-save-result`, `RawFileTab.tsx`) and the
profile's canonical file on disk, read straight off `.ui-verify/fixture/
populated/userdata/Plain-Profile.cfg` with `node:fs`, actually contain the
typed text, and (story 054 D12) **`controls-drag-reorder`** — a real drag
through the running app via low-level `page.mouse.move/down/up` (not
`locator.dragTo()`: `SortableZone`'s `PointerSensor` has an 8px
`activationConstraint.distance`, `SortableList.tsx`, so the pointer has to
actually move past that threshold, in steps, before dnd-kit starts the drag
and registers the hover-over-target along the way). Drags Plain Profile's
"Multi Bind" fixture row onto "Attack" to reorder within the Movement
category, asserting the rendered row order (`[role="rowgroup"][data-row-id]`)
actually changed; then drags "Attack" onto the "Weapons" category chip
(`[data-drop-category="weapons"]`, `ControlsDragZone.tsx`'s
`CategoryDropTarget`), asserting the row left the Movement grid and is
appended at the end of the Weapons grid after switching category, and (story
058 D7) **`care-fix-item`** — drives one Care tidy-up item from listed to
fixed through the row's own action, not the batch dialog: opens Plain
Profile's Overview tab, rebinds `MOUSE1`'s keycap to a raw command that
differs from the "Attack" action's own mirror (`KeyBindDialog` writes
`profile.binds` directly, with no collision guard — the same base-bind-vs-
action contest `analyzeTidyUp`'s `shadowedBind` rule exists to catch), then
opens Care and asserts a `shadowedBind` Tidy-up row named `MOUSE1` appears,
clicks its own **Apply** action, and asserts that row is gone. Stops there
rather than asserting the All clear block reappears: Plain Profile already
carries its own pre-existing findings (the standard catalogue's
`aliasShadowsCommand` warnings and a `duplicateAlias` pair — see
`config-care-clear`'s own comment in `scripts/lib/screens.mjs` for why that
screen uses a different fixture profile), and the keycap dialog's save marks
the profile dirty (story 043 D4), which keeps the canonical file `outOfSync`
until an explicit Save this flow does not perform, and (story 061 D1)
**`config-header-geometry`** — opens Plain Profile's Raw file tab and computes the visible line
count from `.cfg-code`'s real `clientHeight`, its `padding-block` and `--cfg-code-line-h` (each read
via `getComputedStyle`), printing `lines=N margin=Mpx` and failing if the computed count drops below
the story's 30-line budget — the measuring instrument for that budget, not a layout change, and
(story 068 D5) **`engine-not-client`** — the only flow that opens
`CreateInstallationDialog`: clicks the library header's `library-create` button, asserts the
dialog's single `<select>` offers exactly `R1Q2` and `Q2PRO` under a `<label>` reading "Engine"
(read off `HTMLSelectElement.labels`, plus a `getByRole('combobox', { name: /^engine$/i })` count
so the name also exists in the accessibility tree), then closes it with Escape — it never clicks
"Browse" and never submits, because submit is one step from the native folder picker the harness
cannot drive (see "Known blind spots"). Afterwards it asserts the fixture's `unknown`-engine
install badges as `Unknown engine (unsupported)` on its library card, its rail hover card and the
hero panel (activating each install by clicking its rail tile, and restoring the fixture's own
active install at the end) while an `r1q2` install badges as bare `R1Q2`, and that no visible line
of `document.body.innerText` on home or library matches `/\bclient\b/i` — with absolute filesystem
paths stripped first, since a checkout under a directory called `client` is not the launcher's
vocabulary, and with a sentinel check so an empty text read cannot pass that assertion vacuously,
and (story 066 D8) **`import-from-files`** — the first flow to take a fixture variant argument (see
above): run plain (`npm run ui:flow -- import-from-files`) it asserts the "Start from" select's four
options (AC1), that both template options each create a profile carrying its own `seedFrom` (AC3),
that "Choose files…" (`DialogService`'s harness stub, no real OS dialog) lists the three staged
`dm.cfg`/`dmalias.cfg`/`gfx.cfg` fixtures in load order (AC4), and that moving a row and removing one
changes that order (AC5) — `gfx.cfg` is the one removed, since it carries zero `bind`/`alias` lines
of its own, so the profile created afterward still carries every one of `dm.cfg`'s 99 binds and
`dmalias.cfg`'s 96 aliases (`import-fixtures.test.ts`'s corpus test, story 066 D2), read back via a
real `window.q2.invoke('module:invoke', { moduleId: 'config', type: 'list' })` call rather than
scraped off the DOM. Run again with `empty` (`npm run ui:flow -- import-from-files empty`) it skips
the template/options steps and only proves the import path on a launcher with zero installations
registered at all (AC9), and (story 073 D6) **`downloads-tab`** — the Downloads tab's live states
that the static `state.json` fixture cannot seed (Decisions (Sprint), "Fixture split"): asserts the
real `DownloadsView` renders instead of `PlannedModuleView`'s placeholder copy (AC4) and that the
archive cache's seeded 4 MB/2-archive figure is shown (AC3), then drives D5's dev-panel `stall`
button ("Simulate a stalled job") and asserts the resulting job row's bytes/speed/ETA text (AC1),
then drives the `failure` button ("Simulate a failed job") and asserts the resulting failure-log
entry's translated reason persists across a `DownloadsView` remount, dismisses into the collapsed
"Dismissed" disclosure, and restores back into the visible list (AC2) — the only job source is
`dev:simulateJob`, so the flow never touches the network (AC5). Story 075 D7 adds a further
section after that dismiss/restore walk, exercised against the two static `downloadFailures`
entries `scripts/lib/fixture.mjs`'s `populatedDownloadFailures()` seeds directly into `state.json`
(no job round trip, reachable fully offline, AC8): both the with-diagnostics and
without-diagnostics entries render; only the diagnostics entry offers a copy action, the other
renders none at all (not even a disabled stub, AC6); the reveal-log action is present and enabled
on both, since D6 gates it only on `AppInfo` having loaded, not on `diagnostics` (AC5); clicking
copy and reading the OS clipboard back via `app.evaluate(({ clipboard }) => clipboard.readText())`
(the same mechanism `docs/requirements/075-a-failure-tells-me-enough-to-report-it.md`'s Decisions
describe) proves the report contains the Markdown package table, the error key and the AC2 verdict
block (AC3); and that the same text contains the redaction placeholder `<home>` but never the
machine's real `os.homedir()` value (AC4). `shot()`s cover both the with-diagnostics and
without-diagnostics states plus the post-copy toast. And (story 074 D8)
**`bootstrap-wizard`** — the one flow that runs a real download pipeline end to end; it has its own
section below. Two more flows build on it without duplicating its plumbing: (story 076 D6)
**`bootstrap-incomplete-package`** — a package that downloads, verifies and extracts cleanly but
contributes none of its required files, asserting that both the running step and the Downloads
tab's failure card name the same package (AC5); and (story 077 D5) **`bootstrap-failure-retry`** —
a failing bootstrap that leaves its installation in the Library, and the retry that adopts it; it
also has its own section below.

## The offline bootstrap-wizard flow (`bootstrap-wizard`)

`npm run ui:flow -- bootstrap-wizard` is story 074's acceptance run, and the only flow in which the
app does real network I/O, real archive extraction and real installation assembly. Its `setup()`
starts a `node:http` fixture server on `127.0.0.1` (OS-assigned port) serving both manifest files
(`engines/manifest.json`, `gamedata/manifest.json`) plus three real, `7za.exe`-written `.zip`
archives whose declared `sha256`/`sizeBytes` are computed from the bytes actually on disk — so
nothing about verification is faked. It then walks Library → "Download & install" → engine → target
→ confirm → run, lets the real job download, verify, extract and assemble all three packages, and
finally asserts **on disk** that the target holds a `baseq2` directory and no `ctf`/`xatrix`/`rogue`
anywhere under it (AC8). Everything it writes lives under `.ui-verify/fixture/bootstrap/`.

Four things about it are worth knowing before changing it:

- **It is the one flow that reseeds.** Every other flow opens the `populated` fixture as it finds
  it; this one registers a real installation into that state document, and
  `InstallationsService.create()` refuses a second one at the same path, so a second run would fail
  at "start" rather than prove anything. `setup()` therefore calls `writePopulatedFixture()` and
  recreates the target folder.
- **Two harness-only overrides, both behind the same double gate** (`Q2L_UI_HARNESS === '1' &&
  isDev`, `src/main/lib/ui-harness.ts` — unreachable in a packaged build, where `isDev` is always
  `false`; proven by the four gate cases in `src/main/modules/downloads/harness.test.ts`, which
  mirror `dialog.test.ts`'s):
  `Q2L_UI_CONTENT_REPO_BASE` names the manifest/package base URL (`resolveDownloadSource()`,
  `src/main/modules/downloads/harness.ts`) and is *refused* unless it is a `127.0.0.1` origin, so it
  can never redirect a run somewhere public; the production package schema stays https-only and the
  harness path selects a separately named `harnessLoopbackManifestPackageSchema` rather than
  widening it. `Q2L_UI_PICK_FOLDER` is what `installations:pickFolder` answers instead of opening a
  native OS dialog (`src/main/ipc/installations.ts`) — a `path.delimiter`-joined list walked one
  entry per call with the last entry repeating, because this flow picks twice. It is needed at all
  because the wizard's target step has no typeable field (`PathPicker`'s input is `readOnly`).
- **AC2's Program Files verdict is exercised by naming a real Program Files path, not by faking the
  variable.** Story 074's refine expected the latter ("point the child process's `ProgramFiles` at a
  fixture dir"); on Windows that is impossible — `ProgramFiles`, `ProgramFiles(x86)` and
  `NUMBER_OF_PROCESSORS` are regenerated by the loader for every new process, so a value placed in a
  child's environment block is discarded (measured, not assumed; `bootstrap/target.test.ts` can
  still inject a fake root, because it calls `computeTargetVerdict(path, { env })` in-process). The
  flow therefore points step 2 at a never-created path under the machine's real `%ProgramFiles%`,
  asserts and acknowledges the warning, and then re-picks the real fixture target — so nothing is
  ever installed anywhere near Program Files, and the only write attempted there is the same
  throwaway probe marker a real user picking that folder would trigger.
- **AC6 is proven with an in-page sampler, not a single check.** "Play lights up the moment the
  verdict stops being `invalid`/`missing`, even while the job is still copying" is a *window*: an
  injected `setInterval` records `bootstrap-running-step`'s `data-status` next to `actionbar-play`'s
  `disabled`/`data-action` every 5 ms for the whole run, and the flow asserts at least one sample had
  a `running` job and an enabled Play button. A one-shot `page.evaluate()` could only ever prove the
  state it happened to catch. The window is everything between `markPlayable` and `finish` — the
  final revalidation, the `rm -r` of three extract trees, and the two `jobs:changed` round trips with
  their renders — and it measured ~80 ms with the fixture's 900-file `ctf/` payload (~60 ms at 300),
  so the 5 ms interval leaves roughly an order of magnitude of margin.

Because the wizard's own steps live in this flow, `scripts/lib/screens.mjs` deliberately has **no**
registry entry for them (see the comment there): mounting `BootstrapWizard` fetches the curated
manifest, so a registry screen would make every `ui:verify` run reach out to
raw.githubusercontent.com and break the harness's "never touches the network" guarantee. The flow
takes its own `shot()`s of all four steps instead.

The flow needs `resources/bin/7za.exe` (`npm run fetch:7za`) and refuses to run without it rather
than quietly skipping the extraction — the whole point is that the *real* extractor runs.

## The offline bootstrap-failure-retry flow (`bootstrap-failure-retry`)

`npm run ui:flow -- bootstrap-failure-retry` is story 077's own offline e2e proof — "a bootstrap
job that fails leaves its installation registered in the Library, and a retry on the same folder
adopts it instead of erroring `installations.error.duplicate`". It mirrors `bootstrap-wizard.mjs`'s
`setup()`/`teardown()` shape and general structure exactly (same real manifest fetch, real
downloads, real `7za.exe` extraction, same two harness-only overrides — see that flow's own section
above for what those are and why they are safe), and walks the wizard **twice** in one app session:

- **Run 1** picks a genuinely fresh target folder (not the pre-seeded, deliberately-non-empty one
  `bootstrap-wizard.mjs` uses) and lets the job fail — the fixture server is started with a new
  `startBootstrapFixtureServer({ failFirstAttemptFor })` option (`scripts/lib/fixture.mjs`) that
  404s one named package's PRIMARY *and* MIRROR url on their first request only, then serves that
  same package normally ever after. This has to be a property of the *server*, not of the flow:
  `Q2L_UI_CONTENT_REPO_BASE` is fixed for the whole app session, so one flow covering both the
  failing first run and the succeeding retry has no other way to make the second attempt succeed
  where the first did not. The flow fails the engine package specifically — the first one
  downloaded — so run 1 fails before a single byte of any package is assembled into the target,
  which is what makes "the target folder is empty afterwards" (AC1) unambiguous.
- After run 1 fails, the flow asserts the Library still shows the installation under the name the
  wizard gave it, with `FailureBadge`'s "Failed" text, the tile's `.tile-failed-tag` "FAILED"
  microtag, the translated failure sentence (`installation-failure-reason`, reading exactly what
  `downloads.error.allMirrorsFailed` says) and a disabled Play control (AC1/AC5/AC6) — and that the
  target folder is empty on disk (AC1), read directly via `node:fs`, not scraped off the UI.
- **Run 2** re-opens the wizard and picks the *same* folder again — the harness's `Q2L_UI_PICK_FOLDER`
  stub queues only one entry, and its last entry repeats forever, so the second Browse click hands
  back the same path with no second queued value needed. The fixture server now serves the
  previously-404'd package normally, so this run downloads, verifies, extracts and assembles for
  real, adopting the failed installation (its own id, not a second registration) rather than
  refusing with `installations.error.duplicate` (AC7). Once it succeeds, the flow asserts the badge,
  the microtag and the failure sentence are all gone and Play is enabled again (AC4).

This is a *different* fixture entry point than the restart half of AC1: `scripts/lib/fixture.mjs`'s
`populatedInstallations()` also seeds a fourth, standing installation (`Fixture Failed Install`,
`INSTALL_FAILED_ID`) that already carries a `lastFailure` in `state.json` before the app ever boots.
That row is what `npm run ui:verify --screens=library` reads — proving "after an app restart the
failure is still there" without this flow (or any flow) having to observe the failure live — while
`bootstrap-failure-retry` proves the live create → fail → retry → succeed cycle against a wholly
separate, freshly-created installation. The library screen's own axe pass also stays clean with all
four installations visible, which is AC8's proof that the three pre-existing fixture rows render
exactly as they did before this story, right next to the new failed one.

## Baselines and CI

Screenshots are **never diffed** against a committed reference, and this is
deliberate, not a gap to fill in later: a pixel baseline rots on every design
change and turns into noise nobody trusts. They exist purely as evidence for
a human to look at during manual review.

**CI is out of scope for this harness.** It is local-only for now — there is
no GitHub Actions job (or equivalent) that runs `ui:verify`, and adding one is
a decision for a future story, not an implicit consequence of this one.

## Known blind spots

The registry covers every route/tab reachable from the title bar and the
config module's tabs, plus the dialogs listed above, but several surfaces
are not in it yet — none of these are wired to a screen, so a regression in
any of them produces no screenshot and no axe finding:

- Toast notifications (`src/renderer/src/components/ui/Toasts.tsx`) — they
  are ephemeral and store-driven, with no `data-testid`'d trigger a
  `navigate()` could click and then wait on.
- Anything gated behind a native OS file/folder picker
  (`dialog.showOpenDialog`, used from `src/main/ipc/installations.ts`) —
  Playwright cannot drive an OS-native dialog at all, so any renderer state
  that only appears after that dialog resolves is unreachable by this
  harness by construction, not by omission. Story 066 D4/D8 gives the
  config-file picker specifically (`DialogService.pickConfigFiles()`,
  `src/main/services/dialog.ts`) a harness-only stub for exactly this reason
  — `Q2L_UI_HARNESS==='1' && isDev` skips the real dialog and returns fixed
  paths from `Q2L_UI_PICK_FILES` instead, so `config-import-files` and
  `scripts/flows/import-from-files.mjs` cover everything from the resolved
  paths onward (list, reorder, remove, preview, create); only "the OS dialog
  itself appears and is multi-select" stays manual residue, same as every
  other picker below it in this list. Story 074 D8 gives the **folder**
  picker (`installations:pickFolder`, `src/main/ipc/installations.ts`) the
  same treatment for the same reason, reading `Q2L_UI_PICK_FOLDER` behind the
  same double gate — so the bootstrap wizard's target step is reachable, and
  only "the OS folder dialog itself appears" stays manual residue there too.

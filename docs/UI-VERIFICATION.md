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

Today's registry is 22 screens (count the `SCREENS` array in
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
- That header check only catches a *declared* regression. To also catch a
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

`scripts/lib/screens.mjs` had two such entries added by story 037 D3;
`config-write-preview` is retired as of story 057 D7 (see below), leaving one:

- **`config-import-preview`** — the import-preview panel inside
  `ImportProfileDialog` (`src/renderer/src/modules/config/ImportProfileDialog.tsx`).
  Reached via Config list → "New profile" (`config-create-profile`) → source `import`
  (`config-create-source`) → submit (`config-create-submit`) → pick an
  installation with a real `config.cfg` fixture from the
  `config-import-installation` `<select>`. Picking the fixture installation
  triggers a scan and a preview with no further click, and `navigate()` waits
  for `.cfg-code-single` (only ever rendered by this dialog's
  duplicate-bind/preserved-line lists) to be visible.
- **`config-import-restore`** — same dialog, same installation, but Story 042
  D6 picks its second gamedir (`config-import-gamedir` `<select>`, fixture
  name `q2l-restore-fixture`) instead of the auto-selected `baseq2` one. That
  gamedir's fixture config carries the launcher's own ownership sentinel
  (`OWNERSHIP_MARKER`, `@shared/config/render.ts`) naming the "Plain Profile"
  fixture, so the preview's `ownWrittenFile` is true and the dialog renders
  its "restoring a launcher profile" banner instead of the plain best-effort
  wording. `navigate()` waits for that banner's own testid,
  `config-import-restore-banner`.

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
  (the profile's edits dirty in the launcher *and* its canonical file changed
  on disk at the same time) cannot be produced by clicks alone. `navigate()`
  opens the "Plain Profile" fixture's Raw tab, toggles its "Start the file
  with `unbindall`" checkbox (`RawFileTab.tsx`) to make the profile dirty —
  a real `setWriteUnbindall` IPC round trip, not local-only state — waits for
  `ProfileSaveBar`'s "Unsaved changes" text, then drops to the Node side and
  appends one well-formed comment line directly onto the profile's canonical
  `Plain-Profile.cfg` under the fixture's userData dir
  (`variantUserDataDir('populated')`, `scripts/lib/harness.mjs`) — the same
  "hand-edit in Notepad" the story's own acceptance criteria describe, done
  with `node:fs` rather than through `page` since the whole point is a change
  the launcher process has not read. Clicking `config-save`
  (`ProfileSaveBar.tsx`'s Save button) then hits `save`'s `changedOnDisk`
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
per-installation cards and `RawConfigPanel`'s only mount point are both gone
from this tab (`RawConfigPanel.tsx` itself still exists, just unmounted).
`config-write-preview` (story 037 D3, described above in earlier revisions of
this doc) is **retired** as a result: there is no longer any click path that
reaches it. Story 058 ("Care's Sync") remounts that view in a different
feature — a screen entry for it returns there, once it has a new reachable
trigger; see the retirement comment left in place of its old entry in
`scripts/lib/screens.mjs`.

Story 057 D7 adds one more in its place, still on the Raw tab but with no
dialog or panel involved:

- **`config-raw-editing`** — Plain Profile's Raw file tab with a dirty raw
  draft: text typed into the editable code view's real `<textarea>`
  (`.cfg-code-textarea`, `ConfigCodeView.tsx`), not yet saved. `navigate()`
  opens the tab via `configDetail('raw')`, clicks into the textarea and types
  a line, then waits for the save bar's raw-specific summary text
  (`config-save-summary`, `ProfileSaveBar.tsx`, `config.save.rawEdited` — "File
  text edited…") rather than the structured-diff wording the bar shows for an
  ordinary dirty profile. It runs early in the registry, before any other
  `config-*` screen puts Plain Profile's *structured* state (not this
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

None of the 22 screens shipped so far set `coldStart` — every current screen
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
`npm run ui:flow -- <name>`. The flow always launches against the `populated`
fixture at the default 1280x800 viewport (`scripts/flow.mjs`) — flows aren't
part of the registry and don't take a `variant`/`viewports` of their own.

Flows shipped so far, alongside `open-keycap-dialog` above:
`alias-rename-dialog`, `controls-category-rename-reorder`,
`controls-extra-keys`, `controls-subcategory`, `custom-action-row`,
`drop-message-checkbox`, `settings-section-rename-add-cvar`, and (story 057
D7) **`raw-inline-edit`** — types a line into the Raw file tab's real inline
editor (`.cfg-code-textarea`), saves it via the save bar's `config-save`
button (the same path Ctrl+S in the editor calls), then asserts both the
read-back result panel (`config-raw-save-result`, `RawFileTab.tsx`) and the
profile's canonical file on disk, read straight off `.ui-verify/fixture/
populated/userdata/Plain-Profile.cfg` with `node:fs`, actually contain the
typed text.

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
  harness by construction, not by omission.

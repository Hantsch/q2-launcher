---
name: ui-verify
description: "Drive a built Electron app through Playwright's _electron to produce screenshots of every screen and an axe-core accessibility report, without anyone starting the app by hand. Use when: asked to verify, screenshot, smoke-test or look at the UI of an Electron app; setting up UI verification or a visual check; a story needs a live smoke test on a running app; writing functional acceptance or e2e tests that drive the real Electron UI; making a test run stay off the desktop and out of the keyboard focus; splitting e2e runs into one flow per story and all flows per sprint; adding an accessibility gate to CI; reviewing whether a UI change actually renders. DO NOT USE FOR: unit or component tests; web-only apps (use plain Playwright); Electron layering or IPC questions."
---

<!-- tech-rules:managed 2.1.0 -->

# UI Verification for Electron

A harness that starts the built app, visits every screen, writes PNGs and runs axe-core against the
same session. The point is that the UI becomes verifiable without a human starting the app - and
without touching that human's real data.

The same harness is what a functional acceptance suite runs on. Screenshots and axe prove that a
screen renders; they do not prove that a button does what a story says. Where a workflow asks for
acceptance through the real surface (ai-scrum's `ui-acceptance-required`), the answer is flows
driving *this* harness - same app start, same scrubbed env, same seeded fixture - next to the screen
pass, not instead of it. Never offer a screenshot as the acceptance of a behaviour: a PNG cannot
fail a criterion.

## Shape

```
scripts/
  lib/app-harness.mjs   starts the built app, scrubs the env, collects console output
  lib/screens.mjs       the screen list and how to navigate to each one
  seed.mjs              builds the demo fixture the app runs against
  shot.mjs              screenshots every screen -> .screenshots/
  a11y.mjs              axe-core over every screen -> .screenshots/a11y.json
  verify.mjs            the screen pass: screenshot + axe in one visit per screen
  flows/<name>.mjs      a scripted acceptance sequence on the same harness (see Flows)
  flow.mjs              runs one flow by name
  flows.mjs             runs every flow, or the named ones, each on a freshly seeded fixture
```

npm scripts: `seed`, `verify` (with `shot` and `a11y` as its two filters), `flow` and `flows`. The
test run is split on purpose, because the three parts have very different costs and prove different
things:

| Run                      | ai-scrum key | When                  | Proves                                   |
| ------------------------ | ------------ | --------------------- | ---------------------------------------- |
| `npm run verify`         | `e2e`        | per story, per sprint | every screen renders and passes the gate |
| `npm run flow -- {test}` | `e2e-story`  | per story             | this story's criteria, nothing else      |
| `npm run flows`          | `e2e-all`    | once per sprint       | no story broke another story's flow      |

Every flow on every story is what makes a sprint slow without making it safer: a story's own flows
are the ones its change can break directly, and the cross-story breakage the rest would catch is the
sprint gate's job. In this shape `e2e-story` is not optional - without it ai-scrum falls back to the
full `e2e`, which is the screen pass and runs none of the flows.

The screen pass shares the harness with the flows, and screenshot and audit share one visit on
purpose, so "what is in the picture" and "what axe found" are the same state. Sharing the harness
*file* is not enough for that: two runs over the same registry are two different app instances, and
the report then describes a state nobody has a picture of. Screenshot and audit belong in **one
visit per screen** - navigate, shoot, inject axe - with the entry points as filters over that one
pass.

## The harness

```js
import { _electron } from 'playwright'

const MAIN_ENTRY = 'out/main/index.cjs'
const RENDERER_ENTRY = 'out/renderer/index.html'

/** A clear message instead of a Playwright stack trace when the build is missing. */
export function ensureBuild() {
  const missing = [MAIN_ENTRY, RENDERER_ENTRY].filter((p) => !existsSync(join(REPO_ROOT, p)))
  if (missing.length > 0) {
    throw new HarnessError(`Build missing (${missing.join(', ')}). Build first: npm run build`)
  }
}
```

Three Electron specifics the harness must handle:

1. **`ELECTRON_RUN_AS_NODE` has to be removed from the environment.** VS Code's extension host sets
   it and every terminal and task spawned from the editor inherits it; Electron then boots as a plain
   Node process and dies with a confusing error about `isPackaged`. The same fix belongs in the dev
   launcher; `/tech-rules:setup` offers a ready-made env-scrubbing launcher for `npm run dev`.
2. **Each run gets its own `--user-data-dir`**, pre-populated with the settings the run needs
   (window size, theme, which fixture to open, whether onboarding is done). Never let the harness
   read the user's real installation - and never let it write there.
3. **A run stays off the desktop and out of the keyboard focus.** See the next section. Skip it and
   the developer cannot use the machine while a run is going, which ends with the verification not
   being run.

The fixture path and any mode flags go in through environment variables the main process prefers over
its persisted state. Then one built app can be driven into any starting state without a debug build.

## An invisible run

The developer keeps working while the suite runs - so a run neither takes the focus nor paints over
their screen. The price is that nobody watches the run; the screenshots, the axe report and a
failing step's message are the evidence, and a visible opt-out exists for debugging.

Both halves live in the **main process**, because `window.show()` on `ready-to-show` activates and
raises there and no amount of care in the harness can prevent it. Gate them on the verification flag
the harness already sets, so every normal launch stays byte-identical:

```ts
const HARNESS = process.env['APP_UI_HARNESS'] === '1'
const OFFSCREEN = HARNESS && process.env['APP_UI_VISIBLE'] !== '1'

// Module load, before `ready`: Windows occlusion tracking treats an offscreen window as hidden and
// stops painting it, which stalls every screenshot.
if (OFFSCREEN) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// createMainWindow - left of every display, same size, so the layout is the one that ships.
const left = Math.min(...screen.getAllDisplays().map((display) => display.bounds.x))
const window = new BrowserWindow({
  width: saved.width,
  height: saved.height,
  ...(OFFSCREEN ? { x: left - saved.width - 100, y: 0 } : savedPosition(saved)),
  show: false,
  ...(HARNESS ? { focusable: false } : {}),
  webPreferences: { ...SECURE_PREFS, ...(OFFSCREEN ? { backgroundThrottling: false } : {}) },
})

window.once('ready-to-show', () => {
  if (!OFFSCREEN) restoreMaximizedOrFullscreen(window, saved) // would pull it back onto a display
  if (HARNESS) window.showInactive()
  else window.show()
})
```

- **Offscreen, not hidden.** A window that is never shown gets throttled and paints unreliably, and
  `webPreferences.offscreen` switches to a different render path - neither shows what ships. A
  shown window left of every display does, as long as it keeps painting: `backgroundThrottling:
  false` plus the occlusion switch above.
- **`showInactive()` and `focusable: false` together.** `focusable: false` alone leaves Electron
  requesting a focus the window then refuses; `showInactive()` paints without asking for activation.
  On Windows `focusable: false` also keeps the window off the taskbar.
- **The harness keeps it there.** A `resize()` helper must not `center()` the window; it re-derives
  the offscreen position from the new width. Anything else that moves the window - maximize,
  fullscreen, restoring a saved position - is skipped offscreen.
- **`APP_UI_VISIBLE=1` puts the window back on screen** (prefix both variables with the app's name).
  That is the debugging path, not a mode a run needs.
- **One flow checks all of it** (`flows/harness-offscreen.mjs`): the window's bounds intersect no
  display, `isFocused()` is false, `isVisible()` is true, and ten `requestAnimationFrame` ticks land
  within two seconds. A few seconds of run time, and the regression that would put the window back
  in the developer's face or blank every screenshot fails loudly instead of quietly.

Measured on Windows. macOS constrains window positions to the visible screen, so run that flow there
before relying on the offscreen half; the focus half does not depend on it.

## Session boundaries

**One app session per fixture variant, not per screen.** Between screens, `page.reload()`. A fresh
app only where the boot itself is the subject of the shot.

Three tiers, and the middle one is the default:

| Reset           | Cost   | What it actually clears                                          |
| --------------- | ------ | ---------------------------------------------------------------- |
| nothing         | 0      | -                                                                |
| `page.reload()` | ~0.3 s | renderer state: the store, open dialogs, focus, scroll position  |
| a new app       | ~2 s   | additionally the main process: services, caches, boot-time reads |

Relaunching per screen looks like isolation and mostly is not. It does not reset the fixture, it
**re-reads** it - so if the app persists UI state (last route, last selection), the next screen still
starts where the previous one left off, restart or no restart. State resets come from rewriting the
fixture, not from ending the process. What a relaunch does buy is a clean main process, so keep it
for exactly that:

- a screen whose subject is the cold boot (onboarding with no data, a first-run dialog, a migration
  on launch) declares that in the registry (`coldStart: true`) and gets its own app - visible in the
  registry, not hidden in the driver
- a different fixture variant is a different `--user-data-dir` and therefore a different session
- a crashed main process restarts the session and the run continues at the next screen, so error
  isolation is paid for when something is actually broken instead of on every screen

The reason this is a rule and not a preference: measured on two implementations of this skill, the
per-screen variant came to 56 launches and two minutes of stolen focus where the session variant
needs 2 launches and under 30 seconds. Nothing in the evidence differs.

Two more things a session run needs, to keep the per-screen verdict honest:

- **Attribute console output per screen**, by marking the log index before each `navigate()` and
  slicing after it. A session-wide error list is not a finding, it is a rumour.
- **Offer a screen filter** (`--screens dashboard,projects`). The fast edit/verify loop is one
  screen - and a partial run must say it is partial: no stale-renaming of images it never tried to
  write.

## The fixture

**A verification run needs realistic content, and it must be the harness's own.** Generate it
(`seed`), do not point the run at whatever the developer happens to have: a screenshot of somebody's
real data is not reviewable, cannot be diffed, and leaks.

**Write the fixture at the start of every run, not only when it is missing.** "Seed if absent" makes
run N+1 inherit run N's drift, because the app writes into that fixture while it is being verified.
The fixture is generated and costs milliseconds; rewriting it is the only thing that makes two runs
of the same build comparable.

The seed script is where a project's shape shows most, so keep it honest:

- cover the states the screens actually have - populated, empty, in-progress, overdue, error - not
  just the happy one
- if the UI ships more than one language, include content in each of them
- if the app reads something from outside itself (a directory of other tools' data, a system
  location), the seed provides its own version of that too, and the app is pointed at it. Otherwise
  the run picks up foreign content and it ends up in the screenshots.
- **the fixture also switches off what would reach outside it at boot.** A scan of the user's real
  system, a network call, an auto-updater: an empty fixture is exactly the state that triggers those,
  and the resulting modal both leaks foreign content into the screenshots and intercepts every click
  of the run.
- `ensureDemoVault`-style behaviour: if the fixture is missing when `verify` runs, build it rather than
  failing.

## Screenshots

- Two viewports minimum: wide and narrow. Resize inside the session (`win.setSize` - a BrowserWindow
  ignores `page.setViewportSize`); a viewport is not a reason for a new app. A narrow run must also
  visit the states behind a detail route, because an idle list screen reveals nothing about a detail
  column.
- Beyond the main navigation destinations, capture the states a user can get into that a route cannot
  express: a command palette open, keyboard focus visible, onboarding with no data, a secondary
  window, an error state, "nothing configured yet".
- If a screen is taller than the window, take a second shot scrolled to the end - and only then. Two
  identical images, one labelled "scrolled", is worse than one image.
- **Stale output is renamed, not left in place.** Count what this run wrote; anything else in the
  folder becomes `*.png.stale`. Otherwise the folder silently mixes two builds and nobody can tell
  from the pictures.
- **Report what could not be reached; never invent it.** A missing screen is the finding.

## The accessibility gate

`a11y.mjs` injects `axe-core` into each screen over the same harness and writes a findings report.

- **`serious` and `critical` fail the run. `minor` and `moderate` are reported and do not.** A
  threshold that fails on everything gets disabled within a week, which is worse than not having one.
- If the project has its own numeric floor - minimum hit area, contrast ratio - check it alongside
  axe by reading the value out of the stylesheet rather than hardcoding it in the script, so the gate
  and the design tokens cannot drift apart. A mouse-driven desktop app with no tap-target token has
  no such floor, and inventing one in the harness is a design decision the harness does not own.
- Write the report as JSON next to the screenshots. It is evidence for a review, not console output
  that scrolls away.

## Exit codes

Three outcomes, because a caller has to tell them apart:

- **`0`** - clean, or only `minor`/`moderate` findings.
- **`1`** - the harness or the app failed: no build, app did not start, screen unreachable, main
  process crashed, renderer console error or unhandled exception. Warnings do not fail a run.
- **`2`** - the app behaved, axe found `serious`/`critical`.

A screen that never loaded never got a chance to produce findings: record it as "unreachable, axe not
run" rather than as an empty violations list.

## Flows

Static screenshots verify that screens render; a story's acceptance steps are usually a sequence.
Expose one documented way to script one - `flows/<name>.mjs` with a default export receiving
`{ page, app, step(label), shot(label), log }` - so a story writes its own smoke on top of the
harness instead of beside it. Each flow gets its own app session. A failing step exits non-zero
naming the flow and the step.

Two runners, matching the split in Shape:

- **`npm run flow -- <name>`** runs one flow. It is what a story runs for its criteria (ai-scrum's
  `e2e-story: npm run flow -- {test}`), so the flow's file name is the test name a story's
  `## Acceptance Tests` line carries.
- **`npm run flows [name ...]`** runs every flow under `flows/`, sorted, or only the named ones.
  **Each flow in its own process, each against a freshly written fixture** - flows mutate their
  fixture and never reseed themselves, and a crashed flow must not take the rest down. Reseeding
  costs well under a second. Print `[i/n] <name>` before each flow and `<passed>/<total> flows
  passed in <s>s` at the end, list the failed ones by name and exit `1` if there are any. This is
  the sprint's regression gate (`e2e-all`); ai-scrum runs it in the background with its output
  teed into a log, so the progress lines are what the developer watches instead of a window.

## Procedure

1. `npm run build` - the harness runs the built app, not the dev server, so what you verify is what
   ships.
2. `npm run seed` if the fixture is missing (or let `verify` do it).
3. `npm run verify` (or `shot` / `a11y` alone) - read the summary, then look at the PNGs. Looking is
   the point; a green exit code only means nothing crashed. Fix every `serious` and `critical`
   finding.
4. `npm run flow -- <name>` for each flow a story maps its criteria to, where a criterion is about
   what the user does. That run is the acceptance; a PNG cannot fail a criterion.
5. `npm run flows` once the stories are in - the whole set, not per story.
6. Report what you saw per screen, and name explicitly anything you could not reach.

## Review checklist

- [ ] Runs against the built app, not the dev server
- [ ] Own `--user-data-dir` per run; the user's real data is neither read nor written
- [ ] `ELECTRON_RUN_AS_NODE` scrubbed from the environment
- [ ] The run neither takes the keyboard focus nor appears on the desktop: offscreen, still
      painting, `showInactive()`; a visible opt-out; normal launches unchanged; one flow checks it
- [ ] Test run split: screen pass per story, one flow by name per story, every flow once per
      sprint - each flow in its own process on a freshly written fixture, a subset by name
- [ ] One session per fixture variant, `reload()` between screens, a new app only for declared
      cold-start screens and after a crash
- [ ] Fixture rewritten at the start of every run, covering empty/populated/error states - and
      switching off the boot-time side effects that would reach outside it
- [ ] Screenshot and axe come from the same visit to the screen
- [ ] Console output attributed per screen, not per session
- [ ] Wide and narrow viewports, resized inside the session; narrow also visits detail states
- [ ] Non-route states captured (palette, focus, onboarding, error, unconfigured)
- [ ] Stale images renamed, not silently kept; a partial run says it is partial
- [ ] Unreachable screens reported, not skipped quietly
- [ ] Exit codes distinguish clean / harness failure / accessibility findings
- [ ] `serious`/`critical` fail the run; the project's own numeric floor, if it has one, read from
      the stylesheet

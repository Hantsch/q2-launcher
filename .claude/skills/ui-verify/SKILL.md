---
name: ui-verify
description: "Drive a built Electron app through Playwright's _electron to produce screenshots of every screen and an axe-core accessibility report, without anyone starting the app by hand. Use when: asked to verify, screenshot, smoke-test or look at the UI of an Electron app; setting up UI verification or a visual check; a story needs a live smoke test on a running app; adding an accessibility gate to CI; reviewing whether a UI change actually renders. DO NOT USE FOR: unit or component tests; web-only apps (use plain Playwright); Electron layering or IPC questions."
---

<!-- tech-rules:managed 1.0.0 -->

# UI Verification for Electron

A harness that starts the built app, visits every screen, writes PNGs and runs axe-core against the
same session. The point is that the UI becomes verifiable without a human starting the app - and
without touching that human's real data.

This is the concrete implementation of a live smoke test: where a workflow asks for one (ai-scrum's
`live-smoke-required` profile flag, for instance), `npm run shot` is the answer, and
`live-smoke-how` names it.

## Shape

```
scripts/
  lib/app-harness.mjs   starts the built app, scrubs the env, collects console output
  lib/screens.mjs       the screen list and how to navigate to each one
  seed.mjs              builds the demo fixture the app runs against
  shot.mjs              screenshots every screen -> .screenshots/
  a11y.mjs              axe-core over every screen -> .screenshots/a11y.json
```

Three npm scripts: `seed`, `shot`, `a11y`. `shot` and `a11y` share the harness on purpose, so "what
is in the picture" and "what axe found" are the same state.

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

Two Electron specifics the harness must handle:

1. **`ELECTRON_RUN_AS_NODE` has to be removed from the environment.** VS Code's extension host sets
   it and every terminal and task spawned from the editor inherits it; Electron then boots as a plain
   Node process and dies with a confusing error about `isPackaged`. The same fix belongs in the dev
   launcher; `/tech-rules:setup` offers a ready-made env-scrubbing launcher for `npm run dev`.
2. **Each run gets its own `--user-data-dir`**, pre-populated with the settings the run needs
   (window size, theme, which fixture to open, whether onboarding is done). Never let the harness
   read the user's real installation - and never let it write there.

The fixture path and any mode flags go in through environment variables the main process prefers over
its persisted state. Then one built app can be driven into any starting state without a debug build.

## The fixture

**A verification run needs realistic content, and it must be the harness's own.** Generate it
(`seed`), do not point the run at whatever the developer happens to have: a screenshot of somebody's
real data is not reviewable, cannot be diffed, and leaks.

The seed script is where a project's shape shows most, so keep it honest:

- cover the states the screens actually have - populated, empty, in-progress, overdue, error - not
  just the happy one
- include content in every language the UI ships
- if the app reads something from outside itself (a directory of other tools' data, a system
  location), the seed provides its own version of that too, and the app is pointed at it. Otherwise
  the run picks up foreign content and it ends up in the screenshots.
- `ensureDemoVault`-style behaviour: if the fixture is missing when `shot` runs, build it rather than
  failing.

## Screenshots

- Two viewports minimum: wide and narrow. A narrow run must also visit the states behind a detail
  route, because an idle list screen reveals nothing about a detail column.
- Beyond the main navigation destinations, capture the states a user can get into that a route cannot
  express: a command palette open, keyboard focus visible, onboarding with no data, a secondary
  window, an error state, "nothing configured yet".
- If a screen is taller than the window, take a second shot scrolled to the end - and only then. Two
  identical images, one labelled "scrolled", is worse than one image.
- **Stale output is renamed, not left in place.** Count what this run wrote; anything else in the
  folder becomes `*.png.stale`. Otherwise the folder silently mixes two builds and nobody can tell
  from the pictures.
- **Report what could not be reached; never invent it.** A missing screen is the finding.
- Exit non-zero on console errors or unhandled renderer exceptions. Warnings do not fail the run.

## The accessibility gate

`a11y.mjs` injects `axe-core` into each screen over the same harness and writes a findings report.

- **`serious` and `critical` fail the run. `minor` and `moderate` are reported and do not.** A
  threshold that fails on everything gets disabled within a week, which is worse than not having one.
- Check the project's own numeric floor alongside axe - minimum hit area, contrast ratio - by reading
  the value out of the stylesheet rather than hardcoding it in the script, so the gate and the design
  tokens cannot drift apart.
- Write the report as JSON next to the screenshots. It is evidence for a review, not console output
  that scrolls away.

## Procedure

1. `npm run build` - the harness runs the built app, not the dev server, so what you verify is what
   ships.
2. `npm run seed` if the fixture is missing (or let `shot` do it).
3. `npm run shot` - read the summary, then look at the PNGs. Looking is the point; a green exit code
   only means nothing crashed.
4. `npm run a11y` - fix every `serious` and `critical` finding.
5. Report what you saw per screen, and name explicitly anything you could not reach.

## Review checklist

- [ ] Runs against the built app, not the dev server
- [ ] Own `--user-data-dir` per run; the user's real data is neither read nor written
- [ ] `ELECTRON_RUN_AS_NODE` scrubbed from the environment
- [ ] Fixture generated by the seed script, covering empty/populated/error states and every language
- [ ] Wide and narrow viewports; narrow also visits detail states
- [ ] Non-route states captured (palette, focus, onboarding, error, unconfigured)
- [ ] Stale images renamed, not silently kept
- [ ] Unreachable screens reported, not skipped quietly
- [ ] Exit non-zero on console errors and unhandled renderer exceptions
- [ ] axe-core run over the same session; `serious`/`critical` fail the run
- [ ] The numeric a11y floor read from the stylesheet, not duplicated in the script

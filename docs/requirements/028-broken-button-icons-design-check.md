---
id: 028
title: Broken button/nav icons + general design check
status: done # draft -> ready -> in-progress -> done
created: 2026-08-20
---

## Requirement

Icons across the UI appear to be broken. Most clearly visible in the Controls tab
(Config → Controls): custom action rows (e.g. a row named "test") show the outline/box of a
button but no icon inside it, where other rows in the same column render fine. The same kind of
"outline present, icon missing" issue is also visible in the main navigation bar at the top of
the app — icons that used to sit next to/inside the menu are gone.

Beyond the missing icons, the user's general impression is that something about the visual
design has shifted or broken — not just this one icon bug. This story should also produce a
broader design consistency check across the app's surfaces (spacing, icon usage, tokens) to catch
whether this is an isolated icon-rendering bug or a symptom of something wider (e.g. an icon
font/sprite not loading, a broken CSS selector, a regressed build step).

Root-cause analysis and the fix are explicitly **not** done as part of filing this story — they
are the subject of `/refine`, which investigates the cause and turns it into concrete
deliverables (fix + design check) before this goes to `ready`.

## Acceptance Criteria

- [x] Root cause of the missing icons in the Controls tab action rows (e.g. "test" row) is
      identified and fixed; icons render correctly for all rows, including custom/user-created ones.
- [x] Root cause of the missing icons in the main navigation bar is identified and fixed; nav
      icons render correctly.
- [x] A design consistency check has been performed across the app's main surfaces (Home,
      Library, Install, Config tabs, Mods, Assets) confirming icons/spacing/tokens render as intended
      elsewhere, or documenting further issues found.
- [x] No regression in icon rendering for the rows/elements that already worked before this fix.

## Open Questions

Root-cause investigation done so far (static code review + live DOM inspection via the
`ui:verify` harness against the built app):

- **Nav bar (`TitleBar.tsx`):** no code defect found. `Home`/`Settings`/`Minus`/`Square`/`X` are
  literal `lucide-react` imports; module icons resolve through `moduleIcon()`
  (`components/shell/moduleIcons.tsx`), whose fixed map keys match every `MODULE_MANIFESTS` icon
  name exactly (`shared/types/module.ts`). A live DOM dump of the running app (`nav-home` etc.)
  shows every icon's `<svg>`/`<path>` present with correct geometry, a real (non-transparent)
  `currentColor` stroke, `opacity:1`, `visibility:visible`, and a non-zero rendered size — the
  React output and CSS are correct. Independently, a rasterised copy of that same SVG XML paints
  normal, visible pixels. **But** nothing paints on screen in this environment even for a raw,
  hand-injected `<svg><circle fill="red"/></svg>` planted next to the same button — while a plain
  CSS-coloured `<div>` right next to it paints fine. That points at an SVG-paint failure in this
  sandbox's (GPU-less, headless) Electron/Chromium rendering path, not at the app's source code —
  but it means the `ui:verify` screenshot harness cannot currently be used as evidence either way
  for this bug, on this machine.
- **Controls tab custom/plain action rows:** found one concrete, code-provable layout bug,
  independent of the paint question above. `.ctrl-opts` (`styles/controls-grid.css:320-327`) is a
  fixed 150px, `overflow:hidden` column. For a catalogue row it holds exactly one child,
  `ControlsOptionsCell` (`components/ControlsOptionsCell.tsx`), whose own root `<div>` is
  `w-full` — fine when it is the column's only occupant. `ControlsTab.tsx`'s `renderActionRow`
  (custom/plain rows, ~line 650) instead puts that _same_ `w-full` `ControlsOptionsCell` as one
  sibling inside a `flex flex-wrap` row **alongside 5 `IconButton`s** (move up/down, edit, rename,
  remove). `w-full` on a flex item makes it claim the entire 150px line by itself, so — by flexbox
  wrapping rules — all 5 icon buttons get pushed onto their own wrapped line(s) below it, inside a
  box whose parent (`.ctrl-opts`) is clipped by `overflow:hidden` and centred inside `.ctrl-row`'s
  fixed 40px height. That is a real, reproducible-from-source defect that only affects custom/plain
  action rows (the only row kind that combines `ControlsOptionsCell` with the 5 CRUD icon
  buttons in the same cell) — consistent with "works for other rows in the same column" (which
  never render an icon there, only text/dash) and "broken for a custom row."
- Both findings above point at the same underlying symptom shape — SVG/icon content silently not
  showing while its CSS box (border, background) still paints — but only the Controls-tab one has
  an identified, fixable source-code cause. The nav bar may turn out to be the identical class of
  bug (unproven) or a separate, environment-level cause (build cache, GPU driver) outside what a
  code change can fix.

Questions for the user:

1. Does the nav bar problem survive a **clean rebuild** (delete `out/`, `npm run build` again,
   relaunch)? That would rule out a stale/corrupted bundle as the cause.
2. Is the missing-icon problem limited to the Controls tab + nav bar, or do _other_ SVG icons
   elsewhere in the app (chevrons on the Config profile list, the settings gear, checkboxes,
   window min/maximize/close buttons) look broken too? If it is truly everywhere, that supports
   "one systemic paint issue"; if it is only these two spots, that argues for two separate,
   local causes.
3. If possible, a screenshot (or even a phone photo of the screen) of one broken custom Controls
   row and the nav bar would let us confirm exactly what's missing (whole button vs. just the
   glyph) rather than inferring it from code.

**Answered (2026-08-20):** not yet tried a clean rebuild; the missing-icon problem is app-wide,
not limited to Controls/nav. That rules "isolated per-component bug" further out and makes a
stale/corrupted `out/renderer` bundle, a build/dependency regression, or a GPU/driver rendering
problem on the user's machine the more likely explanations for the _app-wide_ part — none of which
this sandbox (no real display, no GPU) can confirm or refute: the checked-in source, freshly
built here, already produces fully correct SVG markup in the DOM (verified above), so there is
nothing further static analysis can add.

**Answered (2026-08-20, round 2):** clean rebuild (`out/` deleted, `npm run build` re-run) done —
icons are still missing. That rules out a stale/corrupted bundle. Combined with round 1's DOM
evidence (the rendered markup is correct: real `<svg>`/`<path>` elements, correct geometry, a real
non-transparent stroke colour, `opacity:1`), an app-wide failure that survives a clean rebuild
points at the app's real, GPU-accelerated Chromium compositor failing to paint SVG stroke content
on the user's machine — a known class of Electron/Chromium bug tied to a specific GPU/driver/ANGLE
backend combination, not at the source.

**Next, cheap diagnostic — no rebuild needed:** run the already-built app with hardware
acceleration off, straight from a terminal, and see if the icons appear:

```
cd C:\development\Hantsch\q2-launcher
node_modules\.bin\electron.cmd . --disable-gpu
```

- If icons **appear** with `--disable-gpu` — confirms a GPU/compositor rendering bug. The fix
  becomes D3: call `app.disableHardwareAcceleration()` in `src/main/index.ts` (`bootstrap()`,
  before `app.whenReady()`) — the standard, well-established Electron workaround for exactly this
  symptom. Trade-off to weigh in the D3 review: hardware acceleration off costs some GPU-accelerated
  compositing performance app-wide; for a launcher UI (no video, no heavy animation) that's normally
  an acceptable trade, but flag it rather than silently deciding it here.
- If icons are **still missing** with `--disable-gpu` — the GPU theory is wrong; reply with that
  result and, if at all possible, a screenshot/photo of the broken nav bar and a custom Controls
  row's Options column, since static analysis has run out of leads without one.

**Answered (2026-08-20, round 3): `--disable-gpu` did NOT fix it — icons still missing.** GPU/
compositor theory is ruled out. User then sent a real screenshot of the running app (Config tab,
`out/renderer/index.html`, DevTools open) plus the DevTools Console contents. Findings from that:

- **Nav bar icons confirmed missing in the real app** (not just this sandbox): "HOME LIBRARY
  INSTALL CONFIG MODS ASSETS" render with no glyph before any label — matches every headless
  finding above exactly, on a real GPU-accelerated Windows Chromium, with hardware acceleration
  both on and off.
- **The "+" add-installation button** (left rail) also renders as an empty dashed-border box, no
  Plus glyph inside — another data point for "app-wide", per the user's earlier answer.
- **Console shows exactly one message**, Electron's own built-in warning: _"Electron Security
  Warning (Insecure Content-Security-Policy) — This renderer process has either no Content
  Security Policy set or a policy with 'unsafe-eval' enabled."_ No red errors, no failed resource
  loads, no React warnings. This is itself a real, separate finding worth fixing (see below) but
  it does not explain the icons: a _missing_ CSP is more permissive, not more restrictive, so it
  cannot be what's blocking rendering.
  - **Likely cause of the CSP warning** (not yet confirmed, not yet fixed): `applySecurityPolicies()`
    in `src/main/index.ts` sets the CSP via `session.defaultSession.webRequest.onHeadersReceived`,
    which intercepts _network_ response headers. The renderer loads via `file://…/index.html` — a
    local file load, not a network response — so `onHeadersReceived` may never fire for it, meaning
    the CSP has likely **never actually been applied** in a production build (dev mode is served
    over `http://localhost` by Vite, where it _would_ fire, which is probably why this was never
    noticed). Worth its own fix (a `<meta http-equiv="Content-Security-Policy">` tag in
    `src/renderer/index.html` would apply regardless of how the document was loaded) but track that
    as a separate, smaller finding under D2 (design/quality sweep) rather than folding it into the
    icon bug — it is unrelated to why icons don't paint.
- Attempted to connect this session directly to the running app's DevTools protocol (Playwright
  `connectOverCDP` over `--remote-debugging-port=9222` / `--remote-debugging-address=0.0.0.0`) to
  inspect live without round-tripping through the user — **blocked by WSL2 network isolation**
  (connections from WSL to the Windows host on that port timed out/refused despite the flag and a
  firewall prompt). Not worth further time sunk into this specific WSL↔Windows networking path.

**Handoff (2026-08-20): user is switching from this WSL session to a native Windows session (VS
Code, not WSL) for direct filesystem/terminal parity — no more relay-through-chat needed for
diagnostics.** The single next concrete step, prepared but not yet run:

Paste into the app's DevTools Console (already known to be reachable — `Ctrl+Shift+I` / `F12`,
Console tab) and read the result directly (no relay needed once running natively):

```js
copy(
  JSON.stringify(
    {
      forcedColors: matchMedia('(forced-colors: active)').matches,
      prefersContrast: matchMedia('(prefers-contrast: more)').matches,
      dpr: window.devicePixelRatio,
      home: (() => {
        const svg = document.querySelector('[data-testid="nav-home"] svg')
        if (!svg) return 'NOT FOUND'
        const cs = getComputedStyle(svg)
        const path = svg.querySelector('path')
        const pcs = getComputedStyle(path)
        return {
          svgRect: svg.getBoundingClientRect().toJSON(),
          svgFill: cs.fill,
          svgStroke: cs.stroke,
          svgColor: cs.color,
          svgFilter: cs.filter,
          svgMixBlend: cs.mixBlendMode,
          svgOpacity: cs.opacity,
          pathStroke: pcs.stroke,
          pathFill: pcs.fill,
          pathStrokeWidth: pcs.strokeWidth,
          pathD: path.getAttribute('d'),
        }
      })(),
    },
    null,
    2,
  ),
)
```

Rationale: everything checked so far (DOM structure, computed styles, no console errors, GPU
on/off) says the icon _code_ is correct and something fails purely at paint time. `forcedColors`
checks one concrete, plausible Windows-specific cause not yet ruled out: Windows High Contrast /
forced-colors mode is known to alter or suppress `currentColor`-driven SVG stroke rendering in
Chromium in ways that don't show up as console errors or computed-style differences in the
properties checked so far. If `forcedColors` comes back `true`, that is very likely the actual
root cause and the fix is scoped and well-known (an explicit `forced-color-adjust` or a
`@media (forced-colors: active)` override). If `false`, this specific theory is also eliminated
and the next avenue is a `Layout`/`Rendering` panel check in DevTools (paint flashing, layer
borders) or trying a completely different consumer of `currentColor`-driven stroke SVGs outside
`lucide-react` to see if the failure is per-library or truly universal.

**What is NOT yet known / still open before this can go to `status: ready`:**

1. Whether `forced-colors` (or another Windows rendering-mode setting) is the actual cause — the
   snippet above is the next thing to run.
2. If that's a dead end: no further hypothesis has been formed yet. Would need either DevTools'
   Rendering panel (paint flashing / layer borders enabled) or comparing against a minimal
   reproduction outside this app's own CSS/build pipeline (e.g. a bare `<svg>` in a blank Electron
   window) to tell "this app's environment" from "this machine's Electron/Chromium install" as the
   scope of the bug.
3. Once a real cause is found for the nav bar / app-wide failure, it becomes **D3** here (files,
   fix, acceptance) and AC2 + the "app-wide" part of AC3 get covered — only then can `status` move
   to `ready`.

The Controls-tab Options-column bug below (D1) is independent of all of the above — it is a
confirmed source defect and worth fixing regardless of what the paint investigation turns up. It
may or may not be the _same_ underlying cause as the nav bar (both are "SVG icon content doesn't
show, its CSS box still does") — D1's fix should be verified against a rebuilt app once the
paint-level cause (if any) is also fixed, in case fixing the real cause makes D1's specific
workaround partially redundant (D1 is a genuine layout bug either way, so it stays worth doing,
but re-check after D3 that both aren't masking each other).

## Plan

1. **D1 (confirmed defect):** fix the Controls-tab custom/plain action row's Options column so its
   5 CRUD icon buttons stop colliding with `ControlsOptionsCell`'s `w-full` div (see Open
   Questions for the exact mechanism) — give the icon-button row and the options text each their
   own space instead of letting the text claim the full 150px line first.
2. **D2:** design-consistency pass across Home, Library, Install, Config (Overview/Settings/
   Controls/Write targets/Raw file/Validation), Mods, Assets — `npm run ui:shot` already covers
   most of these (`scripts/lib/screens.mjs`); review every screenshot plus a live click-through for
   spacing/icon/token drift, and write findings into this story's Done section (fixes only if
   they're as small/obvious as D1 — anything bigger becomes a follow-up story, not scope creep
   here).
3. **AC2 (nav bar) / app-wide half of AC3:** resolved — root cause found and fixed as D3, see
   `## Done`.

## Deliverables

**D1 — fix the Controls tab custom-row Options column layout collision**
Files: `src/renderer/src/modules/config/ControlsTab.tsx` (`renderActionRow`, the `optionsCell`
prop around line 650 — the outer `flex flex-wrap` wrapper combining `renderPlainOptionsCell(action)`
with the 5 `IconButton`s), `src/renderer/src/modules/config/components/ControlsOptionsCell.tsx`
(only if the fix needs an opt-out from `w-full`, e.g. a prop or a wrapping change at the call
site instead), `src/renderer/src/styles/controls-grid.css` (`.ctrl-opts`, `~line 320`, only if the
column itself needs a size/overflow adjustment). Mirror: `renderCatalogOptionsCell` (`ControlsTab.tsx`,
~line 501) for how a catalogue row uses `ControlsOptionsCell` alone in that same cell — do not
change that path's rendering.
Acceptance (AC1, part of AC4): a custom/plain action row (e.g. add one named "test" via "Add
action") shows its move-up/move-down/edit/rename/remove icon buttons fully, none clipped or
wrapped out of the visible row; a catalogue row's Options column (dash / layer / conflict text,
and the drops-row message icon) is pixel-for-pixel unchanged.

**D2 — design consistency check**
Files: none touched unless D2 turns up something as small/obvious as D1 (then note it here and
fix inline); the deliverable itself is the review pass and its written findings (append to
`## Done` below, or a short new subsection here if `/build` prefers).
Acceptance (AC3): every one of Home, Library, Install, Config's five tabs, Mods, Assets has been
looked at (screenshots + a live click-through, not just the fixture's default state) and either
confirmed fine or has a documented finding.

**D3 — remove the global `scrollbar-gutter: stable` and scope it to the view scrollers**
(added 2026-08-21, covers AC2 and the app-wide half of AC3 — root cause and fix in `## Done`).
Files: `src/renderer/src/styles/index.css` (gutter removed from the `* { }` rule, explanatory
comment left in place), `scrollbar-gutter-stable` added to the `overflow-y-auto` roots of
`HomeView.tsx`, `LibraryView.tsx`, `SettingsView.tsx`, `PlannedModuleView.tsx`, `ConfigView.tsx`.

## Model Hints

D1 → deliverable-hard. Risk: `ControlsOptionsCell` is shared between catalogue rows (D6/story 020)
and custom/plain action rows (review-fix addition, story 020) — a wrong fix (e.g. changing the
component's own markup instead of how `renderActionRow` composes it) risks regressing every
catalogue row's Options column, not just the custom-row case this story is about.

D2 → default tier (a review-and-document pass, not a code change with correctness risk).

Review: → default.

## Test Plan (manual acceptance)

D1 (live UI path, per `ui-acceptance-required`): in the built app, open a config profile →
Controls tab, add a custom category or use an existing one, click "Add action", give it a name
(e.g. "test"), confirm. Check its row's Options column: all 5 icon buttons (move up, move down,
edit, rename, remove) must be present, not wrapped onto a clipped second line, not overlapping the
row below. **Note for `/build`:** this sandbox's `ui:verify`/`ui:shot` screenshots do not reliably
paint SVG icon content in this environment (confirmed during this refine — even a synthetic
injected SVG failed to rasterize in a screenshot while sibling CSS content painted fine), so pixel
comparison alone is not trustworthy evidence here. Prefer a DOM/layout assertion instead (e.g. a
flow script reading each `IconButton`'s `getBoundingClientRect()` and asserting all 5 sit fully
inside `.ctrl-opts`'s box with no overlap) alongside a screenshot for human eyeballing.

D2: `npm run ui:shot` covers Home/Library/Install/Config-tabs already; Mods/Assets are
`PlannedModuleView` screens (module scaffolding only, per `docs/ROADMAP.md`) — confirm whatever
they currently render is what's actually shipped, note if the registry needs a Mods/Assets screen
added first.

## Done

**Root cause found and fixed (2026-08-21, native Windows session — D3).** The app-wide missing
icons were never a paint/GPU/build problem: commit `8b8e534` ("button fix, story 28 created",
2026-08-20) added `scrollbar-gutter: stable` to the global `* { }` rule in
`src/renderer/src/styles/index.css` — the same commit that filed this story. `stable` applies to
every scroll container, and `overflow: hidden` counts as one; an `<svg>` root's UA default _is_
`overflow: hidden`. Chromium therefore reserved the app's 10px `::-webkit-scrollbar` width inside
every SVG's box: below ~15.5px CSS size nothing paints at all (proven with a size ladder injected
into the running app — same SVG invisible at ≤15px, fine at ≥15.5px; `scrollbar-gutter: auto` or
`overflow: visible` on the same 14px SVG made it paint). Every `size-3.5` (14px) lucide icon —
nav bar, "+" rail button, maximize Square, all Controls CRUD buttons — was blanked, while `size-4`
(16px) icons (gear, Minus, X) survived, which produced the confusing "some icons work" picture.
This also explains every dead end in Open Questions: DOM/computed styles were correct
(`scrollbar-gutter` was never inspected), clean rebuild/GPU on-off changed nothing (it's checked-in
CSS), and even the WSL sandbox's hand-injected raw SVG failed because it inherited the same `*`
rule from inside the app document.

The same rule also silently reserved 10px inside every _other_ `overflow: hidden` element — e.g.
`.ctrl-opts` (the Controls Options cell) lost 10px of its 150px track, and every Tailwind
`truncate` span was affected. So the fix removes the gutter from `*` entirely and scopes it to the
five full-height view scrollers it was actually meant for (`scrollbar-gutter-stable` on the
`overflow-y-auto` roots of `HomeView`, `LibraryView`, `SettingsView`, `PlannedModuleView`,
`ConfigView`) — the Overview <-> Settings layout jump the original commit fixed stays fixed.

**D1 (Controls custom-row Options cell) — fixed.** Two combined defects: the icon glyphs were
blanked by the root cause above, and the layout genuinely wrapped buttons out of the 40px row
(confirmed by rect measurement: the Remove button sat on a wrapped line overlapping the footer).
The 150px track fits five 28px icon buttons only at 2px gaps (5x28 + 4x2 = 148px), so
`renderActionRow`'s Options wrapper drops `flex-wrap`, uses `gap-0.5`, and lets the
`ControlsOptionsCell` text collapse (`min-w-0` + `overflow-hidden`) instead of claiming the line —
conflict/layer state remains visible on the slots themselves and the header conflict badge.
Verified by the committed flow `scripts/flows/custom-action-row.mjs` (creates a "test" action,
asserts all 5 buttons sit fully inside `.ctrl-opts` and the row): passes. Catalogue rows
(`renderCatalogOptionsCell`) untouched; their dash/Options column verified unchanged in
`config-controls` screenshots.

**D2 (design consistency check) — done.** Full `npm run ui:shot` suite (14 screens x 2 viewports)
plus live click-throughs reviewed after the fix: icons, spacing and tokens consistent on Home,
Library (incl. empty), Install (planned), Config list/Overview/Settings/Controls/Write
targets/Validation/Preserved, Settings, Mods/Assets (planned views), keybind dialog. Findings
documented, all pre-existing and out of scope here:

1. **Raw file tab crashes** (`RawConfigPanel`: `TypeError: Cannot read properties of undefined
(reading 'length')`) against the populated fixture — reproduced on clean HEAD before this
   story's changes; `config-raw` screenshots show the error boundary. Needs its own story.
2. **axe criticals (pre-existing):** `select-name` on the Config list (redundant-copies
   installation `<select>` has no accessible name) and `label` on the keybind dialog's filter
   input. Plus `scrollable-region-focusable` (serious) on the crashed raw tab. Also for a
   follow-up story.
3. **CSP never applied in production builds** (from the earlier investigation, unchanged):
   `applySecurityPolicies()` sets the CSP via `onHeadersReceived`, which does not fire for
   `file://` loads — a `<meta http-equiv="Content-Security-Policy">` in `src/renderer/index.html`
   would. Separate, small security follow-up.

**Verification:** `npm run typecheck` clean, 697/697 unit tests pass, `ui:shot` writes 26/28
screens (the 2 errors are finding 1 above), `ui:flow custom-action-row` passes. Note for future
sessions: the earlier WSL sandbox could not rasterise SVG in screenshots; this native Windows
session can — screenshots here are trustworthy evidence again.

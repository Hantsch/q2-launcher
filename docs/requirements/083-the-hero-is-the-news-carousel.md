---
id: 083
title: The hero is the news carousel
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

The top of the home screen becomes the community front page: a rotating hero showing the news the
feed delivered, in the shape the prototype decided — a 320px band spanning the full width next to
the installation rail, above the dashboard. It is the launcher's face, so it must look the same
for everyone: contributors fill fields, they do not design slides.

I must be able to read it at my own speed. It rotates by itself, but stops the moment I hover or
focus it, and there is a pause I can latch. If I have no feed yet, it welcomes me instead of
showing an empty box. If the feed is old because the fetch failed, it says so quietly. A slide's
buttons open in my browser — the launcher never navigates itself somewhere.

See [concepts/home-screen.md](../concepts/home-screen.md) §7 and §11 (variant A is the reference).

## Acceptance Criteria

- [ ] **AC1** — The hero is 320px high, spans the width between the installation rail and the
      window edge, and cannot be moved, resized, hidden or placed by the user.
- [ ] **AC2** — `split`, `banner` and `text` are rendered by launcher-side renderers; a slide's
      frontmatter fills their fields and can contribute no CSS, HTML, colour or layout value.
- [ ] **AC3** — The carousel auto-advances and offers dots, previous, next and an explicit pause
      control.
- [ ] **AC4** — Auto-rotation pauses while the pointer is over the hero or focus is inside it, and
      stays paused after the pause control is used until it is pressed again.
- [ ] **AC5** — With reduced motion, auto-rotation does not run and slide changes do not animate;
      dots, previous and next still work.
- [ ] **AC6** — With no cached feed at all, the hero shows a built-in welcome slide that uses no
      bitmap image and names the first steps; a real feed displaces it.
- [ ] **AC7** — A feed shown after a failed refresh carries an "as of <date>" note and a refresh
      affordance, and no dialog or toast.
- [ ] **AC8** — A slide shows at most three buttons, and pressing one opens the URL through main
      with `shell.openExternal`; the renderer cannot open a URL itself.
- [ ] **AC9** — The carousel is a labelled region, slide changes are announced in a polite live
      region, the slide position is readable as text and not only as a coloured dot, and every
      control is keyboard reachable with a visible focus ring.
- [ ] **AC10** — The hero's filled, welcome and stale states are entries in the `ui:verify` screen
      registry, fed from the fixture without network access, and a full run stays at zero axe
      violations.

## Decisions (Sprint)

- **(User)** Manual refresh affordance sits in the hero, next to the content it refreshes — not
  the titlebar.
- **(User)** Button/host allowlist: fixed constant containing only the community content repo's
  host (shared decision with 082).
- Auto-rotation interval: kept at the concept's placeholder, 8 s — a pure balancing value, not
  escalated to the user.
- Geometry: the hero is full-bleed at the top of the home module's view — exactly 320px
  (`h-80 shrink-0`), no horizontal padding, closed by a bottom rule, with the dashboard region
  below carrying the padding. Reason: that is literally what prototype variant A does
  (`docs/prototypes/home/_home.css` `.hero` = `flex:none; height:320px; border-bottom`), and AC1's
  "spans between rail and window edge" only holds if the padding sits on the dashboard.
- No new top-level IPC channel: 083 consumes the `home` module handlers and the feed event that
  082 declares, over the existing shell-owned `module:invoke`/`module:event` envelope. Reason:
  `ARCHITECTURE.md` fixes that modules never widen the renderer's IPC surface.
- Slide buttons open through a **new `home` handler** (`openSlideUrl`) that re-checks 082's host
  allowlist, not through the existing `app:openExternal`. Reason: `app:openExternal` validates the
  scheme only, so a feed URL — foreign content — would bypass the allowlist at open time.
- The welcome slide is a renderer-side state built from i18n keys, not a synthetic slide sent by
  main. Reason: CLAUDE.md's "main sends i18n keys, never prose".
- The stale note is derived from the delivered feed's retrieval timestamp plus its
  refresh-failed indication; if 082 shipped only the timestamp, 083 adds that one boolean field to
  `src/shared/modules/home.ts`. Reason: AC7 needs "the last refresh failed", which is not the same
  fact as "the feed is from yesterday".
- Reduced motion is read in JS through a `useReducedMotion()` hook in the home module (store
  `settings.motion`, plus `matchMedia` when it is `system`). Reason: the existing `data-motion`
  mechanism only zeroes CSS duration tokens and cannot stop a timer (AC5 forbids the timer, not
  just the animation).
- Slide position is shown as a monospace `n / m` counter next to the dots. Reason: AC9 demands the
  position as text; the prototype has coloured dots only, so this is a deliberate addition to it.
- Hero controls (dots, prev, next, pause, refresh) get a 44px-minimum pointer hit area with a
  small visual mark inside it, so **no new token deviation is needed**. Reason: unlike the dense
  config grids, a 320px hero has the room — a deviation that can be avoided is not a deviation.
- The refresh affordance sits in the same top-right chip as the "as of <date>" note (the
  prototype's `.stale` cluster), which is the concrete placement behind the user's "in the hero".
- `ui:verify` determinism: the app-start feed fetch is suppressed under the existing
  `Q2L_UI_HARNESS` gate, so the three hero screens are fed purely by the seeded cache — mirroring
  the `DialogService` harness stub (`src/main/lib/ui-harness.ts`). Reason: offline, every launch
  would otherwise be a failed refresh and the filled state could not be screenshotted.
- Templates take an **optional** image URL and fall back to the `text` layout without it, so 083
  is complete before 084 lands. Reason: 083 is built before 084 in the sprint order, and the
  concept requires a slide without its image to still render.
- The slide body is plain text with a line clamp — no markdown rendering. Reason: concept §2
  "Deliberately not in v1".

## Open Questions

- ~~What is the auto-rotation interval? (Concept open point 3, placeholder 8 s.)~~ resolved —
  placeholder value kept, see Decisions (Sprint).
- ~~Where does the manual refresh affordance sit — in the hero, in the titlebar utility row, or
  both? (Concept open point 10.)~~ answered → Decisions (Sprint)
- ~~Which hosts does the button allowlist contain? (Concept open point 6 — shared with 082.)~~
  answered → Decisions (Sprint)

## Plan

Everything lands **inside the `home` module** (renderer half from 081, main half from 082). The
shell is not touched; no new top-level IPC channel is declared.

1. **Pure state first.** `carousel.ts` — a reducer over `{ index, count, latched, hovered,
   focused, reducedMotion }` with `next/prev/goto/tick/…` and a derived `isRunning`. The whole of
   AC3/AC4/AC5's *logic* is provable without React.
2. **Templates.** `split`, `banner`, `text` as three launcher-side renderers over a fixed field
   set, plus the fallback path and the shared button row (max 3, no `href`). Image URL optional →
   `text` layout when absent (084 fills it later).
3. **Hero shell.** `NewsHero.tsx` mounts the reducer on a timer, wires hover/focus/latch, renders
   region label, polite live region, dots + `n / m` counter, prev/next, pause. Placed full-bleed
   at 320px above the dashboard in the module's view.
4. **Feed states.** Welcome (no cache ever) and stale ("as of <date>" + refresh) on top of 082's
   feed client; a failure stays inside the hero — no toast, no dialog.
5. **Open path.** `openSlideUrl` handler in `src/main/modules/home/`, re-checking 082's allowlist,
   called from the renderer through `callModule()`.
6. **Harness.** Fixture writers for a fresh / absent / aged-and-failed feed cache, three screen
   registry entries, and one asserting `ui:flow` that measures the geometry and drives the
   carousel by pointer and keyboard.

Order matters: 1 → 2 → 3 → 4, then 5 and 6 in parallel. Affected files are named per deliverable.
Nothing outside `src/renderer/src/modules/home/`, `src/main/modules/home/`,
`src/shared/modules/home.ts`, `en.json`, `scripts/lib/{fixture,screens}.mjs` and
`scripts/flows/` changes.

**Guardrails to keep in sight:** feed prose crosses IPC as data, every label around it is an i18n
key; semantic tokens only, no hex, no raw palette class; the renderer never holds a remote URL and
never opens one; unvalidated foreign content never reaches the renderer (082's job, not re-done
here, but do not add a second unvalidated path).

## Deliverables

**D1 — the carousel is a pure, tested state machine.**
New: `src/renderer/src/modules/home/carousel.ts`, `carousel.test.ts`.
Accepted when: `next/prev/goto` wrap and clamp; `tick` advances only while running; `isRunning` is
false while hovered, while focus is inside, while latched by the pause control, and always under
reduced motion; the latch survives a hover leaving. No React, no DOM.

**D2 — three templates and a button row that cannot navigate.**
New: `src/renderer/src/modules/home/components/{SlideSplit,SlideBanner,SlideText,SlideButtons}.tsx`,
`src/renderer/src/modules/home/slides.test.tsx`, `src/renderer/src/styles/home-hero.css`
(mirror: `src/renderer/src/styles/controls-grid.css` for a module-scoped stylesheet).
i18n keys in `src/renderer/src/i18n/locales/en.json`.
Accepted when: each template renders its documented field set and nothing else; an unknown
template value renders through `text`; a missing image renders through `text`; at most three
buttons render; a button is a `<button>` with no `href` and no `window.open`; no `style` attribute
or class comes from feed data.

**D3 — the hero itself, 320px and accessible.**
New: `src/renderer/src/modules/home/NewsHero.tsx`, `useReducedMotion.ts`, `NewsHero.test.tsx`.
Changed: the home module's view from 081 (`src/renderer/src/modules/home/HomeView.tsx`) — hero
full-bleed `h-80 shrink-0` on top, padding moves to the dashboard region.
Accepted when: the hero is a labelled region; dots, prev, next and pause exist, are keyboard
reachable and focus-visible; a `n / m` counter is present as text; slide changes are announced in
a polite live region; pointer hover and focus-within stop the timer, pause latches; under reduced
motion no timer runs and no transition class is applied while dots/prev/next still work.

**D4 — welcome and stale, quietly.**
Changed: `NewsHero.tsx`, `en.json`. New: `src/renderer/src/modules/home/feedState.ts` (+ test)
mapping the delivered feed to `welcome | stale | filled`. Possibly one field added to
`src/shared/modules/home.ts` (see Decisions).
Accepted when: with no cached feed the hero shows the built-in welcome slide, with no `<img>` and
with the first steps named from i18n keys; a real feed displaces it; a feed after a failed refresh
shows an "as of <date>" chip plus a refresh button in the hero, and raises no toast and no dialog.

**D5 — a slide button opens in the browser, through main.**
New: `src/main/modules/home/open-slide-url.ts` (+ `.test.ts`), handler registered in
`src/main/modules/home/index.ts` (mirror: `src/main/ipc/app.ts:38` for the `shell.openExternal`
call). Changed: the renderer's home client call site in `SlideButtons.tsx`.
Accepted when: the handler opens only `http(s)` URLs whose host is on 082's allowlist constant and
returns a refusal otherwise, with a log line; the renderer only ever passes the URL through
`callModule()`.

**D6 — the three states are screens, and the interaction is machine-verified.**
Changed: `scripts/lib/fixture.mjs` (feed-cache writers, new `news-stale` variant), `scripts/lib/screens.mjs`
(entries `home-hero` / `home-hero-welcome` / `home-hero-stale`), main's harness gate
(`src/main/lib/ui-harness.ts` consumer in the home module) to skip the start fetch.
New: `scripts/flows/home-hero-carousel.mjs` (mirror: `scripts/flows/config-header-geometry.mjs`
for measuring-and-throwing).
Accepted when: `npm run ui:verify` produces the three screens from the fixture with no network and
zero axe violations; `npm run ui:flow -- home-hero-carousel` throws if the hero is not 320px high,
does not span rail-to-window-edge, does not auto-advance, keeps advancing while hovered, advances
under `data-motion=reduced`, or has a control that is not keyboard reachable.

## Model Hints

- `D3 → deliverable-hard` — the timer lives next to three independent pause reasons (hover, focus,
  latch) and a fourth kill switch (reduced motion); this is exactly where a stale interval, an
  effect loop or a pause that silently stops latching gets shipped, and it must cooperate with the
  existing `data-motion` mechanism instead of duplicating it.
- D1, D2, D4, D5, D6 → default.
- `Review: → story-review-hard` — the story puts foreign network content on the launcher's most
  prominent surface and adds an `openExternal` path; a review that misses a URL escaping the
  allowlist or a style value escaping from feed data is a security regression, not a nit.

## Acceptance Tests

- AC1 → D3; e2e `scripts/flows/home-hero-carousel.mjs` › "the hero is 320px and spans from the
  rail to the window edge" (measures the bounding box at both viewports and throws), plus the
  registry screen `home-hero` in `npm run ui:verify`.
- AC2 → D2; unit `src/renderer/src/modules/home/slides.test.tsx` › "each template renders its own
  field set, an unknown template falls back to text, and feed data contributes no style or class".
- AC3 → D3; e2e `scripts/flows/home-hero-carousel.mjs` › "dots, previous, next and pause each
  change the slide, and the carousel advances on its own".
- AC4 → D1 + D3; unit `src/renderer/src/modules/home/carousel.test.ts` › "hover and focus pause
  the rotation and the pause control latches until pressed again", plus e2e
  `scripts/flows/home-hero-carousel.mjs` › "hovering the hero stops the rotation".
- AC5 → D1 + D3; unit `carousel.test.ts` › "reduced motion never runs the timer", plus e2e
  `scripts/flows/home-hero-carousel.mjs` › "under reduced motion nothing rotates by itself and
  dots, previous and next still work".
- AC6 → D4; e2e registry screen `home-hero-welcome` (fixture variant `empty`) in
  `npm run ui:verify`, plus unit `src/renderer/src/modules/home/feedState.test.ts` › "with no
  cached feed the welcome slide is chosen and carries no bitmap".
- AC7 → D4; e2e registry screen `home-hero-stale` (fixture variant `news-stale`) in
  `npm run ui:verify`, plus unit `feedState.test.ts` › "a feed after a failed refresh is stale,
  carries its retrieval date and raises no toast".
- AC8 → D5 + D2; unit `src/main/modules/home/open-slide-url.test.ts` › "a URL outside the host
  allowlist is refused and never reaches shell.openExternal", plus unit `slides.test.tsx` › "a
  slide button is a button without an href and calls the home client".
- AC9 → D3; e2e `scripts/flows/home-hero-carousel.mjs` › "the hero is a labelled region, its slide
  position is readable as text, and every control is reachable by Tab with a visible focus ring",
  plus the zero-axe-violation gate of `npm run ui:verify`.
- AC10 → D6; e2e `npm run ui:verify` — the three entries `home-hero`, `home-hero-welcome`,
  `home-hero-stale` render from the seeded fixture with the start fetch suppressed, and the full
  run reports zero axe violations.

No manual residue.

## Done

_Filled by `/build 083`._

---
id: 030
title: Titlebar and wordmark scale up
status: ready
created: 2026-08-21
---

## Requirement

The title bar is the first thing a user sees and the primary way to switch modules, but
today it is a thin 44px strip (`--titlebar-h` in
[src/renderer/src/styles/index.css](../../src/renderer/src/styles/index.css)) with a small
text-only wordmark. It should read as a proper header: comfortably taller, easy to read and to
click, with the wordmark ("Q2 LAUNCHER" + tagline in
[TitleBar.tsx](../../src/renderer/src/components/shell/TitleBar.tsx)) at least twice its
current size.

## Acceptance Criteria

- [ ] The title bar is noticeably taller than the current 44px (target roughly 64-72px) —
      value change lives in the `--titlebar-h` CSS variable, nothing hardcoded per component.
- [ ] The wordmark (title + tagline block) renders at least twice its current font size and
      stays vertically centred in the taller bar.
- [ ] Nav items, the Settings icon and the window control buttons (minimize/maximize/close)
      scale up proportionally so nothing looks stranded in the extra height — no leftover
      44px-tall element floating in a 64-72px bar.
- [ ] The window drag region still covers the full bar height; double-click-to-maximize and
      window controls keep working exactly as before.
- [ ] `npm run ui:verify` screenshots show the new proportions on every screen (titlebar is
      part of every screenshot).

## Open Questions

None — resolved during refine, see Decisions (Sprint).

## Decisions (Sprint)

- **Height = 68px.** The midpoint of the 64-72px range the AC asks for; it leaves ~11px of air
  above and below a 46px-tall wordmark block and fits 44px controls with room to spare.
- **`--titlebar-h` in `index.css` stays the single source of truth, and the stale
  `TITLEBAR_HEIGHT = 36` in `src/shared/constants.ts` is deleted.** It has zero importers and
  already drifted from the CSS (36 vs 44) while claiming to mirror it — a second, unused copy of
  the number directly contradicts the AC's "nothing hardcoded per component".
- **Wordmark: 13px → 26px title, 9px → 18px tagline (exactly 2x).** The AC says "at least
  twice"; exactly 2x is the smallest change that satisfies it and keeps the bar's proportions
  predictable.
- **Wordmark/nav font sizes keep the file's existing arbitrary `text-[Npx]` convention** rather
  than being lifted to new tokens — `TitleBar.tsx` already sizes chrome type that way, and the
  AC asks for an exact doubling that no Tailwind scale step hits.
- **No copy change.** The keys render "QUAKE II" + "LAUNCHER" (`app.wordmark`, `app.tagline`);
  the story is about size, so the strings are untouched.
- **Settings/Downloads icon buttons and window controls go to the 44px hit-area floor**
  (currently 32px / 32x44). `/design-tokens` requires 44x44 and CLAUDE.md's deviations cover
  only the Controls grid and the dense cvar rows — a 68px bar has the room, so this story
  removes a violation instead of adding a deviation.
- **The right-cluster icon-button style is factored into one local sub-component** in
  `TitleBar.tsx`, mirroring the existing local `NavItem`/`WindowButton` pattern, so Settings and
  the Downloads button that [[031]] adds cannot drift in size.
- **No focus-ring work.** `index.css:228-236` already gives the whole app one amber
  `:focus-visible` outline, so `/design-tokens`' focus requirement is met by inheritance — the
  resized buttons only need to be *checked*, not changed.
- **Built on top of [[031]], which lands first.** 031 moves the Install/Downloads entry out of
  the primary nav into an icon-only button left of Settings; this story scales whatever shape it
  finds there and must not reintroduce a nav entry for it.

## Plan

Presentation-only change, renderer only. Two files carry it, plus one deletion.

1. **Token.** `src/renderer/src/styles/index.css:134` — `--titlebar-h: 44px` → `68px`. Nothing
   else consumes the value: `AppShell.tsx` lays out with flexbox, no `calc(100% - …)` exists,
   `.drag-region`/`.no-drag` in `surfaces.css` are region rules with no numbers. Delete the
   unused `TITLEBAR_HEIGHT` from `src/shared/constants.ts:23` (typecheck proves no importer).
2. **Wordmark** (`TitleBar.tsx`, the `pr-5 pl-4` block): `text-[13px]` → `text-[26px]`,
   tagline `text-[9px]` → `text-[18px]`, keep `font-display`/tracking/`stencil`, keep
   `items-center` so the block stays vertically centred. Widen the padding a step
   (`pl-4 pr-5` → `pl-5 pr-6`) so the larger type does not collide with the first nav item.
3. **Nav items** (`NavItem`): icon `size-3.5` → `size-4.5`, label `text-[12px]` → `text-[13px]`,
   `px-3.5` → `px-4`, active underline `inset-x-2` → `inset-x-3`. The buttons already stretch
   via `items-stretch`, so they fill 68px automatically — no height to set.
4. **Right cluster** (`TitleBar.tsx`): pull the Settings button's classes into a local
   `ChromeIconButton` sub-component (next to `WindowButton`) and use it for Settings *and* for
   the Downloads button 031 leaves behind, at `size-11` with a `size-5` icon. `WindowButton`
   goes `h-8 w-11` → `h-11 w-12`, icons `size-4` → `size-5` (`Square` `size-3.5` → `size-4`).
   Divider `h-5` → `h-7`. Leave the `no-drag`/`drag-region` classes, `aria-label`/`title` and
   every `onClick` exactly as they are; the focus ring is global and needs no per-button class.
5. **Verify.** `npm run typecheck && npm run build && npm test`, then `npm run ui:verify` —
   its output lands in the gitignored `.ui-verify/` (screenshots + `a11y.md`), so nothing is
   committed; confirm exit 0, no new critical/serious axe violation and no console error.
   Finally eyeball the app at the minimum window size (940x620) for clipping.

Order matters only in that step 1 comes first (everything after is judged against the taller
bar). 031 must be merged before this story starts.

## Deliverables

- **D1 — Taller bar, one source of truth.**
  Files: `src/renderer/src/styles/index.css` (`--titlebar-h: 68px`),
  `src/shared/constants.ts` (delete `TITLEBAR_HEIGHT`).
  Acceptance: the bar renders 68px tall, the shell below it reflows with no gap or overlap,
  `npm run typecheck` + `npm run build` + `npm test` green. *(covers AC 1)*

- **D2 — Wordmark at 2x.**
  Files: `src/renderer/src/components/shell/TitleBar.tsx` (wordmark block only).
  Acceptance: title 26px, tagline 18px, block vertically centred in the 68px bar, no clipping
  or overlap with the first nav item at the 940px minimum window width. *(covers AC 2)*

- **D3 — Nav, Settings/Downloads and window controls scale with the bar.**
  Files: `src/renderer/src/components/shell/TitleBar.tsx` (`NavItem`, `WindowButton`, new local
  `ChromeIconButton`, right-cluster markup). Mirror the existing local sub-component pattern in
  the same file (`WindowButton`) for the new one.
  Acceptance: no interactive element in the bar is smaller than 44px in its hit area; Settings
  and the Downloads button from [[031]] share one sub-component and one size; nav items fill the
  bar height; every button keeps its `no-drag`, `aria-label`/`title` and click handler; the
  header is still one full-height `drag-region`, and double-click-to-maximize plus
  minimize/maximize/close behave as before. *(covers AC 3, AC 4)*

- **D4 — Refreshed verification run.**
  Files: none committed — the harness writes to the gitignored `.ui-verify/`
  (`run.json`, `screenshots/`, `a11y.json`/`a11y.md`); see `docs/UI-VERIFICATION.md`.
  Acceptance: `npm run ui:verify` exits 0, every screen's screenshot shows the new titlebar
  proportions, no new critical/serious axe violation versus the previous report, no console
  errors; the run's outcome is recorded in this story's `## Done`. *(covers AC 5)*

### Coverage

AC1 → D1 · AC2 → D2 · AC3 → D3 · AC4 → D3 · AC5 → D4.

## Model Hints

D1 → default (one CSS value plus one dead-constant deletion).
D2 → default (font-size classes in one block).
D3 → default (class-level resizing in a single file; the only real care is not disturbing
`no-drag`/`drag-region` and the click handlers, which is a read-and-keep, not a design problem).
D4 → default (run the harness, commit the artefacts).
Review: → default — presentation-only, one renderer component plus one CSS variable, no IPC, no
main-process and no state change; the regression surface is visual and D4's screenshots show it.

## Test Plan (manual acceptance)

1. `npm run build` then start the app (or `npm run dev`).
2. The title bar reads as a header: clearly taller than before, "QUAKE II / LAUNCHER" legible at
   arm's length, block centred vertically.
3. Nav items (Home, Library, Config, …) fill the full bar height; the Downloads and Settings
   icon buttons and the three window buttons all look at home in the taller bar — nothing
   floating at the old small size.
4. Drag the window by an empty part of the bar → the window moves. Click a nav item, the
   Downloads button, the Settings button → they navigate and do *not* move the window.
5. Double-click an empty part of the bar → maximizes; double-click again → restores.
6. Minimize, maximize/restore and close all work.
7. Press `Tab` repeatedly from the wordmark → every nav item and every chrome button shows the
   app's amber focus ring, unclipped in the taller bar.
8. Resize the window down to its minimum (940x620) → nothing in the bar is clipped, the
   wordmark does not collide with the nav, and the content below is still usable.
9. `npm run ui:verify` → exit 0; skim `.ui-verify/screenshots/` for the new proportions on
   every screen.

## Done

---
id: 065
title: Installation name carries an engine badge everywhere it is shown
status: ready
created: 2026-09-07
---

## Requirement

An installation's engine decides what a config may contain, so wherever the launcher names an
installation the user wants to see which engine it runs — as a badge next to the name, not as a
detail one screen away.

Some surfaces already do it: the installation rail
([InstallationRail.tsx:258-263](../../src/renderer/src/components/shell/InstallationRail.tsx#L258-L263))
and the hero panel
([HeroPanel.tsx:57-64](../../src/renderer/src/components/shell/HeroPanel.tsx#L57-L64)) render
`engineLabel(engineKind)` in a `Badge`. Others name the installation with no engine information at
all — inside the config module:
[InstallationProfilesPanel.tsx:61](../../src/renderer/src/modules/config/InstallationProfilesPanel.tsx#L61)
and
[ProfileAssignmentsPanel.tsx:62](../../src/renderer/src/modules/config/ProfileAssignmentsPanel.tsx#L62)
— and two more show it as plain meta text rather than a badge
([LibraryView.tsx:245](../../src/renderer/src/views/LibraryView.tsx#L245),
[ActionBar.tsx:91](../../src/renderer/src/components/shell/ActionBar.tsx#L91)).

So this is a consistency story: one badge treatment for the engine, applied to every surface that
shows an installation name, driven by the `engineKind` the record already carries
([installation.ts:63](../../src/shared/types/installation.ts#L63)) — and the badge's own markup
extracted once instead of the `engineKind === 'r1q2' ? 'flame' : 'neutral'` tone expression being
repeated per call site.

## Acceptance Criteria

- [ ] **AC1** — Every surface that shows an installation name shows its engine as a badge next to
      that name: rail, hero, library cards, action bar, and the config module's installation lists
      (`InstallationProfilesPanel`, `ProfileAssignmentsPanel`).
- [ ] **AC2** — The badge is one shared component; no call site repeats the tone-per-engine
      expression.
- [ ] **AC3** — An installation whose engine is `unknown` gets a badge too, labelled as unknown
      rather than blank or omitted.
- [ ] **AC4** — The badge does not squeeze the name out: with a long installation name in a narrow
      panel the name truncates and the badge stays visible.
- [ ] **AC5** — No image assets; badge is CSS/inline SVG per the repo rule.

## Open Questions

- [x] ~~Was the report about the config module's lists specifically, or about every surface? Filed
      as "every surface" because that is the consistent end state — say so if the scope should be
      just the config module.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Scope is every surface, as filed: rail, hero, library cards, action bar, and both
  config-module lists (`InstallationProfilesPanel`, `ProfileAssignmentsPanel`) all get the badge.
- **Shared component** is `EngineBadge` in `src/renderer/src/components/ui/` next to `Badge`
  ([primitives.tsx:56](../../src/renderer/src/components/ui/primitives.tsx#L56)) — flat `components/ui/`
  is this repo's atom convention. It takes `engineKind: EngineKind` (not an `Installation`), so the
  inspection/candidate call sites can use it too.
- **Two further call sites join AC2**, beyond the six named in the requirement:
  [AddExistingDialog.tsx:123](../../src/renderer/src/components/installations/AddExistingDialog.tsx#L123)
  and [DetectDialog.tsx:229](../../src/renderer/src/components/installations/DetectDialog.tsx#L229)
  repeat the same tone expression. AC2 says *no* call site repeats it, so they migrate as well.
- **Tone map stays exactly as today** (`r1q2` → `flame`, every other kind → `neutral`), including
  `unknown`. Extracting the expression must not change how rail and hero look; per-engine tones
  would be a separate story.
- **No i18n keys.** Engine labels are product names and deliberately untranslated
  ([engine.ts:30](../../src/shared/types/engine.ts#L30)); `engineLabel('unknown')` already returns
  `'Unknown engine'`, which satisfies AC3's "labelled" without a new string.
- **AC5 is free by construction**: badge is text in a bordered `<span>` — no `img`, no asset. The
  unit test asserts the absence rather than trusting it.
- **`Badge` gains an optional `testId?: string`** so the flow can select badges by testid; mirrors
  the existing prop convention in
  [TitleBar.tsx:130-142](../../src/renderer/src/components/shell/TitleBar.tsx#L130-L142). No
  behaviour change for existing usages.
- **The UI fixture gains a third populated installation** with a 100+ char name and
  `engineKind: 'unknown'` — without it, AC3 and AC4 have no e2e path at all (both fixture installs
  are `r1q2` with short names, and `CreateInstallationDialog` needs a native folder dialog the
  harness cannot drive). Harness selectors address installations by label, not index
  ([screens.mjs:562](../../scripts/lib/screens.mjs#L562)), so the addition is additive.
- **Acceptance vehicle for the user-facing criteria is a `ui:flow` script**, following the existing
  "acceptance flow" precedent (`scripts/flows/care-duplicate-name.mjs`). `npm run ui:verify` covers
  screenshots + axe for the changed surfaces; the flow carries the real assertions.

## Plan

1. **Extract the badge.** New `src/renderer/src/components/ui/EngineBadge.tsx`: an
   `ENGINE_BADGE_TONES`-style single expression (`kind === 'r1q2' ? 'flame' : 'neutral'`) plus
   `engineLabel(kind)` inside `Badge`, with `data-testid="engine-badge"`. Add the optional
   `testId` prop to `Badge` in `primitives.tsx` for that.
2. **Migrate the four sites that already show a badge** — `InstallationRail.tsx:261-263`,
   `HeroPanel.tsx:63-65`, `AddExistingDialog.tsx:123-125`, `DetectDialog.tsx:229-231` — to
   `<EngineBadge engineKind={...} />`. Pure substitution; the rendered output must not change.
3. **Add the badge to the two config lists.** `InstallationProfilesPanel.tsx:60-62` and
   `ProfileAssignmentsPanel.tsx:59-64`: badge directly after the name, `shrink-0`, and the name
   itself made shrinkable (`InstallationProfilesPanel`'s `shrink-0 truncate` on the name is
   self-defeating for AC4 — drop `shrink-0` there, keep `min-w-0 truncate`).
4. **Promote the two plain-text sites to badges.** `LibraryView.tsx:245` and `ActionBar.tsx:91`
   currently print `engineLabel(...)` as meta text in the row *below* the name: remove that span
   and its `/` separator and put an `EngineBadge` in the name row instead (LibraryView already has
   a `flex flex-wrap` name row next to the active/favorite markers; ActionBar's name div becomes a
   `flex min-w-0 items-center gap-2` row with the truncating name plus a `shrink-0` badge). No
   surface shows the engine twice afterwards.
5. **Fixture + flow.** Third populated installation in `scripts/lib/fixture.mjs`
   (`engineKind: 'unknown'`, long name, own game root in the `installIds` mkdir loop), then
   `scripts/flows/engine-badge-surfaces.mjs`: at a narrow viewport, walk home (rail hover card,
   hero, action bar) → library → config assignment panels and assert on every surface that an
   `engine-badge` is visible with a non-zero bounding box, that the long-named install's badge
   reads `Unknown engine`, and that its name element is clipped rather than pushing the badge out.

Order: 1 → 2 → (3, 4 independent) → 5. Renderer-only; no IPC, no main-process change, no new
i18n keys.

## Deliverables

- **D1 — `EngineBadge` + `Badge.testId`.** New `src/renderer/src/components/ui/EngineBadge.tsx`;
  `testId?: string` added to `Badge` in `src/renderer/src/components/ui/primitives.tsx` (mirror:
  `TitleBar.tsx`'s `testId` prop). Plus its test in
  `src/renderer/src/components/ui/EngineBadge.test.ts` (mirror:
  `src/renderer/src/modules/config/components/DropToggles.test.ts` — `// @vitest-environment jsdom`
  docblock, RTL via `createElement`, `initI18n('en')` in `beforeAll`).
  *Accepted when:* the badge renders `R1Q2` with the flame tone classes for `r1q2`, the neutral
  tone for every other `EngineKind`, `Unknown engine` for `unknown`, and its subtree contains no
  `img` element.
- **D2 — Existing badge call sites use it.** `src/renderer/src/components/shell/InstallationRail.tsx`,
  `components/shell/HeroPanel.tsx`, `components/installations/AddExistingDialog.tsx`,
  `components/installations/DetectDialog.tsx`.
  *Accepted when:* no file in `src/renderer` still contains `engineKind === 'r1q2' ? 'flame'`, and
  the four surfaces render an identical badge to before (`npm run ui:shot` screenshots of `home`,
  `library`, `install-detect-dialog` unchanged in appearance).
- **D3 — Config lists get the badge.** `src/renderer/src/modules/config/InstallationProfilesPanel.tsx`,
  `ProfileAssignmentsPanel.tsx`, plus their test in
  `src/renderer/src/modules/config/InstallationProfilesPanel.test.ts` (one file covering both
  panels; mirror: `DropToggles.test.ts`, with `useLauncher`'s `installations` seeded).
  *Accepted when:* each row shows the engine badge after the installation name; a row for an
  `unknown`-engine install shows a badge reading `Unknown engine`; with a 120-char name the name
  element carries `truncate` inside a `min-w-0` shrinking box and the badge node is still rendered
  as its sibling (jsdom does not lay out — the visual half of AC4 is D5's flow).
- **D4 — Library card and action bar promote meta text to a badge.**
  `src/renderer/src/views/LibraryView.tsx`, `src/renderer/src/components/shell/ActionBar.tsx`.
  *Accepted when:* both show the engine as a badge next to the name, the old plain-text engine span
  and its `/` separator are gone, and the surrounding meta row still reads without a dangling
  separator.
- **D5 — Fixture install + acceptance flow.** `scripts/lib/fixture.mjs` (third populated
  installation: new id constant, entry in `populatedInstallations()`, id added to the `installIds`
  mkdir loop; mirror: `INSTALL_CONTROLS_SEED_ID`), new
  `scripts/flows/engine-badge-surfaces.mjs` (mirror: `scripts/flows/care-duplicate-name.mjs`).
  *Accepted when:* `npm run ui:flow engine-badge-surfaces` passes — a visible, non-zero-box engine
  badge on all six surfaces, `Unknown engine` on the long-named install, its name clipped and the
  badge still inside the panel — and `npm run ui:verify` stays green (axe report gains no new
  violation, all 34 screens still reachable with the extra installation present).

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- D4 → default
- D5 → **deliverable-hard** — the populated fixture feeds all 34 `ui:verify` screens and every
  `scripts/flows/*` script, so a third installation can silently break label-based selectors,
  profile-assignment lists and the axe baseline; the agent has to add it additively and re-verify
  the whole harness, not just its own flow.
- Review: → default — renderer-only, presentational, no IPC channel, no main-process or
  `webPreferences` surface touched.

## Acceptance Tests

- AC1 → e2e `scripts/flows/engine-badge-surfaces.mjs` › "every surface that names an installation
  shows an engine badge" (rail hover card, hero, action bar, library card, `InstallationProfilesPanel`,
  `ProfileAssignmentsPanel`) — delivered by D2/D3/D4, asserted by D5.
- AC2 → unit `src/renderer/src/components/ui/EngineBadge.test.ts` › "the engine tone lives in one
  place" (tone-per-kind table driven through `EngineBadge`), plus D2's repo check that no
  `engineKind === 'r1q2' ? 'flame'` expression remains in `src/renderer` — delivered by D1/D2.
- AC3 → unit `src/renderer/src/components/ui/EngineBadge.test.ts` › "an unknown engine still gets a
  labelled badge" and e2e `scripts/flows/engine-badge-surfaces.mjs` › "the unknown-engine install
  reads Unknown engine on every surface" — delivered by D1/D3/D5.
- AC4 → e2e `scripts/flows/engine-badge-surfaces.mjs` › "a long name truncates and the badge stays
  visible" (narrow viewport, badge `boundingBox()` non-zero and within the panel box, name element
  `scrollWidth > clientWidth`), plus unit
  `src/renderer/src/modules/config/InstallationProfilesPanel.test.ts` › "a long installation name
  does not push the badge out of the row" for the DOM structure — delivered by D3/D4, asserted by D5.
- AC5 → unit `src/renderer/src/components/ui/EngineBadge.test.ts` › "the badge renders no image
  asset" (no `img` element, no inline `background-image`) — delivered by D1.

## Done

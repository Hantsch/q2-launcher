---
id: 099
title: About tells me what changed
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-13
---

## Requirement

Settings' About section
([SettingsView.tsx:139](../../src/renderer/src/views/SettingsView.tsx#L139)) today lists a version
number and the runtime versions underneath it — true, and useless for deciding whether to update.
A user who is being asked by [[098]] to restart their launcher wants to know what they get for it,
and a user who just updated wants to know what they got. Both are the same question asked from two
sides, and the answer is the release notes [[096]] publishes with every release.

So About becomes the place where the version stops being a bare number: what this version brought,
what a pending update would bring, and a way through to the full history for anyone who wants it.
The notes come from the release, not from a second hand-maintained text in the app — the changelog
is already the single source ([[096]] AC1).

## Acceptance Criteria

- [ ] **AC1** — About shows what changed in the currently running version, not only its number.
- [ ] **AC2** — When [[097]] has an update available, About shows that version's notes too, marked
      as not yet installed, next to the same update action [[098]] offers in the titlebar.
- [ ] **AC3** — About links out to the project and to the full changelog, opened in the system
      browser through the existing external-link path, never in an app window.
- [ ] **AC4** — About says when the launcher last checked for updates and lets the user check now,
      showing the outcome including a failure reason ([[097]] AC7).
- [ ] **AC5** — Notes that are unavailable (never fetched, offline, an older version that predates
      published releases) render as a readable empty state, never as a blank panel or a crash.
- [ ] **AC6** — The notes render as readable text — headings and list items from the changelog
      section — not as raw markdown source, and cannot inject markup into the renderer.

## Open Questions

- ~~**Where do the notes for the _installed_ version come from?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** The installed version's notes are bundled from `CHANGELOG.md` at build/package time;
  only the pending update's notes are fetched live (via [[097]]'s state) — AC1 works offline.
- **R1 — No markdown dependency is added.** The repo has none today (no `marked`, `react-markdown`,
  `dompurify`, `remark`, and no `dangerouslySetInnerHTML` anywhere in `src/renderer`); the changelog
  subset that has to render is `### Heading` + `- item`, which a ~80-line pure parser covers at a
  fraction of a dependency's surface.
- **R2 — Markdown becomes data, never HTML.** `parseReleaseNotes()` returns
  `{ heading, items: string[] }[]` of plain strings that React renders as text children, so AC6 is
  structurally true rather than a sanitiser's promise: no HTML string is ever produced, and raw
  HTML in a release body renders as visible literal text.
- **R3 — The changelog enters the bundle as a static `?raw` import** of the repo's `CHANGELOG.md`
  ([[096]] AC1) in the main process, plus a one-line ambient declaration — build-time bundling as
  the user decision requires, with no runtime file read and no `extraResources` entry to keep in
  sync.
- **R4 — Only the running version's own section is shown.** AC1 asks what *this* version brought;
  the full history is AC3's link, so main resolves exactly one section and never concatenates.
- **R5 — Installed notes travel over a new core channel `app:getReleaseNotes`**, not as a field on
  `AppInfo`: About is shell, not a module (`src/main/ipc/app.ts` is its home), and `AppInfo` is the
  cheap bootstrap payload every session pays for, while the notes are fetched on mount.
- **R6 — The pending update's notes are parsed in the renderer** from [[097]]'s state string with
  the same shared parser. A second channel would only mirror 097's state and duplicate its
  reactivity; parsing is safe here precisely because of R2.
- **R7 — 099 adds no update-check channels of its own.** It consumes [[097]]'s state/manual-check
  channels and [[098]]'s update action as they land; where 098 left that action inline in its
  popover, D4 extracts it so titlebar and About drive the same IPC (AC2's "the same update action").
- **R8 — About moves out of `SettingsView.tsx`** into `components/about/AboutPanel.tsx`: the section
  grows from four `KeyValue` rows to three blocks, and the view stays a composition of panels.
- **R9 — Every unavailable case is a sentence, not a blank.** The existing `EmptyState` primitive
  with one i18n key per cause (never checked, no section for this version, check failed with
  reason) — AC5 is a rendered explanation, and the three causes are distinguishable.
- **R10 — AC3 gets an observable through a harness-gated recorder.** Under `isUiHarnessEnabled()`
  (`src/main/lib/ui-harness.ts`: `Q2L_UI_HARNESS=1` **and** `isDev`, unreachable in a packaged build
  by construction) `app:openExternal` records the URL to a file in userData instead of calling
  `shell.openExternal`, so the flow can prove "left through the external path, opened no window"
  without launching a browser on the test machine.
- **R11 — e2e means a `ui:flow` script plus a `ui:verify` screen entry**, the house convention since
  [[095]]: `ui:verify`'s registry carries screenshots + axe + console/CSP failures, the flow carries
  the assertions.
- **R12 — The parser caps its input** (characters, sections, items, item length) so a hostile or
  oversized release body cannot stall the renderer; overflow is truncated, never thrown.
- **R13 — No new CSS file, no new colour.** The notes block is Tailwind token classes on the
  existing `Panel`/`Divider`/`SectionLabel`/`Badge` primitives, and "not yet installed" is a badge
  with a word in it, never colour alone (`/design-tokens`).

## Plan

About stops being four version rows and becomes three blocks in one panel: **this version**
(bundled notes), **an available update** (097's notes + 098's action, marked not installed), and
**update status** (last checked + check now), with the existing paths/links rows below unchanged.

**Shared (D1).** `src/shared/release-notes.ts` — pure, no node/DOM: `parseReleaseNotes(markdown)`
→ `ReleaseNoteSection[]` (`### Added` → heading, `- item` → item, inline `**`/`` ` ``/`[label](url)`
flattened to their text, everything else dropped), and `extractVersionSection(changelog, version)`
→ the raw fragment for one version or `null`. Tolerant of a GitHub release body that starts at
`### Added` with no `## [x]` header (R6). Caps per R12.

**Main (D2).** `CHANGELOG.md` is imported `?raw` into `src/main/ipc/app.ts`'s neighbourhood (a small
`src/main/lib/release-notes.ts` resolver), `app.getVersion()` selects the section, and the new
`app:getReleaseNotes` channel returns `{ version, date, sections } | null`. Contract first:
`src/shared/ipc.ts` → `src/shared/ipc-schemas.ts` (`z.void()` req, mirroring `appGetInfoSchema`) →
handler. Preload needs no change (allowlist derives from the arrays).

**Renderer (D3–D5).** New `src/renderer/src/components/about/`: `AboutPanel.tsx` (the panel, moved
out of `SettingsView.tsx` verbatim, then extended), `ReleaseNotes.tsx` (sections → `<h*>` + `<ul>`,
text children only), `UpdateCheckRow.tsx` (relative "last checked" via the existing
`formatRelativeTime`, a check-now `Button`, the outcome/failure line). `APP_CHANGELOG_URL` joins
`APP_REPO_URL` in `src/shared/constants.ts`; both links go through `invoke('app:openExternal', …)`
exactly as the repository link does today. Strings under `settings.about.*` in `en.json`.

**Verification (D6–D7).** D6 adds the harness-gated `openExternal` recorder (R10). D7 adds
`scripts/flows/about-release-notes.mjs` plus fixture variants seeding 097's persisted state
(update available with notes incl. an injection probe / update available without notes / a failed
check with a reason) and one `scripts/lib/screens.mjs` entry so `ui:verify` screenshots and
axe-scans the update-available About.

**Dependency:** D2 needs [[096]]'s `CHANGELOG.md` to exist (static import), D4/D5/D7 need [[097]]'s
state + manual-check channels and [[098]]'s action component. Build order D1 → D2 → D3 → D4 → D5 →
D6 → D7.

## Deliverables

### D1 — The shared release-notes parser

`parseReleaseNotes(markdown: string): ReleaseNoteSection[]` and
`extractVersionSection(changelog: string, version: string): { version, date, body } | null`, pure
and dependency-free (R1, R2, R12).

- Files: `src/shared/release-notes.ts`, `src/shared/release-notes.test.ts` (both new)
- Mirror: `src/shared/modules/home.ts` for the shared-layer style (no node, no DOM, exported types);
  `src/shared/constants.ts` header comment for the layer rule
- Accepts `## [1.0.0-beta.1] - 2026-09-13` sections and a bare `### Added` fragment; items keep
  their text with `**bold**`, `` `code` `` and `[label](url)` reduced to `bold`, `code`, `label`;
  unknown blocks (tables, code fences, images) are dropped, not passed through.
- Tests in `src/shared/release-notes.test.ts`: a real Keep-a-Changelog body parses into its
  groups in order; a version with no section returns `null`; empty/whitespace input returns `[]`;
  **`<img src=x onerror="alert(1)">` and `<script>` survive only as literal text in `items` and are
  never structure**; input past the caps truncates instead of throwing.
- Accepted when: `npm test` + `npm run typecheck` green and the file imports nothing.

### D2 — The bundled changelog and `app:getReleaseNotes`

- Files: `src/shared/ipc.ts`, `src/shared/ipc-schemas.ts`, `src/shared/types/common.ts` (the
  `ReleaseNotes` response type, next to `AppInfo`), `src/main/lib/release-notes.ts` (new, the
  `?raw` import + version selection), `src/main/lib/release-notes.test.ts` (new),
  `src/main/ipc/app.ts`, `src/main/types/raw-modules.d.ts` (new, one `declare module '*.md?raw'`)
- Mirror: `app:getInfo` end to end — `ipc.ts:60`, `appGetInfoSchema` (`ipc-schemas.ts:18`, `z.void()`),
  `registerAppIpc` (`src/main/ipc/app.ts:12`)
- Returns `null` when the running version has no section (dev versions, a pre-release-era build) —
  that is AC5's data half, not an error.
- Tests: the resolver picks the running version's section out of a multi-version changelog, returns
  `null` for an unknown version, and the channel's response type-checks against the contract
  (the repo's IPC coverage test already fails if the channel is unhandled).
- Accepted when: `npm test`, `npm run typecheck`, **`npm run build`** green (the `?raw` import has
  to survive the real main bundle, not just vitest).

### D3 — About renders this version's notes and links out

`AboutPanel` extracted from `SettingsView.tsx`, fetching `app:getReleaseNotes` on mount, rendering
the sections under the version row, the `EmptyState` sentence when there are none, and the two
external links (project, full changelog).

- Files: `src/renderer/src/components/about/AboutPanel.tsx` (new),
  `src/renderer/src/components/about/ReleaseNotes.tsx` (new),
  `src/renderer/src/components/about/AboutPanel.test.tsx` (new),
  `src/renderer/src/views/SettingsView.tsx`, `src/shared/constants.ts` (`APP_CHANGELOG_URL`),
  `src/renderer/src/i18n/locales/en.json`
- Mirror: `src/renderer/src/modules/downloads/DownloadsSettingsSection.tsx:39-60` for the
  fetch-on-mount + `cancelled` guard; `SettingsView.tsx:206-213` for the `openExternal` button
- Testids: `about-release-notes`, `about-release-notes-empty`, `about-link-repository`,
  `about-link-changelog`.
- Tests in `AboutPanel.test.tsx`: notes render as headings + list items; a section whose item
  contains `<img src=x onerror=…>` renders that text and produces **no** `img` element in the DOM;
  a `null` response renders the empty-state sentence; both link buttons invoke `app:openExternal`
  with the two constants.
- Accepted when: `npm test` + `npm run typecheck` green; `SettingsView.test.tsx` still passes
  unchanged (the section order Library → modules → About is that test's subject).

### D4 — The pending update's notes, marked not installed

Reads [[097]]'s update state from the renderer store, parses its notes with D1's parser, and renders
them above this version's block with a "not yet installed" `Badge` and [[098]]'s update action next
to them.

- Files: `src/renderer/src/components/about/AboutPanel.tsx`,
  `src/renderer/src/components/about/AboutPanel.update.test.tsx` (new), plus the one-file extraction
  of 098's action component if it is still inline in its popover (R7)
- Mirror: 098's titlebar control for the action wiring; `src/renderer/src/components/ui/primitives.tsx`
  `Badge` for the marker
- Testids: `about-update-available`, `about-update-version`, `about-update-notes`,
  `about-update-action`.
- Tests: an available state renders the version, the badge and the parsed notes; an available state
  **without** notes renders the empty-state sentence, not a blank block; an up-to-date state renders
  neither block; the action button is the same component/IPC the titlebar uses.
- Accepted when: `npm test` + `npm run typecheck` green.

### D5 — Last checked, and check now

- Files: `src/renderer/src/components/about/UpdateCheckRow.tsx` (new),
  `src/renderer/src/components/about/UpdateCheckRow.test.tsx` (new),
  `src/renderer/src/components/about/AboutPanel.tsx`,
  `src/renderer/src/i18n/locales/en.json`
- Mirror: `formatRelativeTime` (`src/renderer/src/lib/format.ts:55`) for the timestamp; the
  downloads section's busy-button pattern for the in-flight state
- Renders: "last checked <relative>" (or "never checked"), a check-now `Button` disabled while a
  check runs, and the outcome line afterwards — up to date / version found / **failure with
  097's reason key** (AC4, [[097]] AC7). Failure is text + icon, never colour alone.
- Testids: `about-update-last-checked`, `about-update-check-now`, `about-update-outcome`.
- Tests: never-checked, checked-with-timestamp, failure-with-reason and in-flight each render their
  own line; the button calls 097's manual-check channel exactly once per click.
- Accepted when: `npm test` + `npm run typecheck` green.

### D6 — Harness-gated external-link recorder

Under `isUiHarnessEnabled()` only, `app:openExternal` appends the URL to
`<userData>/ui-harness-external.json` and returns `ok` instead of calling `shell.openExternal`.

- Files: `src/main/ipc/app.ts`, `src/main/lib/ui-harness.ts`, `src/main/lib/ui-harness.test.ts`
- Mirror: the existing harness gates in `src/main/modules/downloads/harness.ts` and their
  four-case test table (`harness.test.ts:82-100`) — dev-only **and** env-only must both stay on the
  production path
- Tests: the same four-case table for the new gate; the recorder writes the URL; production path
  still reaches `shell.openExternal` (the existing `urlSchema` rejection is untouched).
- Accepted when: `npm test` green and the gate is provably closed unless both conditions hold.

### D7 — The acceptance flow and the `ui:verify` screen

- Files: `scripts/flows/about-release-notes.mjs` (new), `scripts/lib/fixture.mjs` (variants
  `about-update` / `about-update-no-notes` / `about-check-failed`, seeding 097's persisted update
  state next to `state.json`), `scripts/lib/screens.mjs` (one entry
  `settings-about-update-available`)
- Mirror: `scripts/flows/settings-downloads-section.mjs` (navigation via `nav-settings`, testid
  assertions, reading files back out of `variantUserDataDir()`); `writeNewsFeedCache()`
  (`fixture.mjs:111-119`) for seeding an extra userData JSON file
- The seeded pending notes contain an injection probe (`<img src=x onerror="alert(1)">`, `**bold**`)
  so AC6 is proven on the real surface independently of what the repo's own changelog says.
- Steps: read `package.json` version + `CHANGELOG.md` in the flow and assert About shows exactly
  that section's items (or the documented empty state when the version has no section); assert the
  pending block's version, badge and parsed items, and that the probe produced text but **no** `img`
  element; assert the no-notes variant shows the empty state; assert the failed-check variant shows
  its reason; click both links and assert the recorded URLs in `ui-harness-external.json` with
  `electronApp.windows().length` unchanged; click check-now and assert the outcome line changes and
  nothing crashes.
- Accepted when: `npm run ui:flow -- about-release-notes` exits 0 and `npm run ui:verify` exits 0
  (0 axe violations on the new screen).

## Model Hints

- D2 → `deliverable-hard` — the bundled changelog has to resolve identically in `electron-vite dev`,
  in the packaged main bundle and under vitest, and the wrong mechanism (`?raw` typing, root
  resolution, `externalizeDepsPlugin`) fails only at package time, where no test in this story runs.
- D1, D3, D4, D5, D6, D7 → default. Each mirrors an existing file named in its deliverable.
- Review: → `story-review-hard` — AC6 is a security claim about foreign content (a GitHub release
  body) rendered in the renderer, and the story's wiring spans two sibling stories' contracts plus a
  new harness gate; neither is visible in a single diff hunk.

## Acceptance Tests

- AC1 → e2e `scripts/flows/about-release-notes.mjs` › "About shows the running version's changelog
  section, not just its number" — plus unit `src/main/lib/release-notes.test.ts` › "the running
  version's section is selected out of a multi-version changelog"
- AC2 → e2e `scripts/flows/about-release-notes.mjs` › "an available update's notes show marked as
  not yet installed, next to the update action" — plus unit
  `src/renderer/src/components/about/AboutPanel.update.test.tsx` › "an available update renders
  version, badge, notes and the titlebar's own action"
- AC3 → e2e `scripts/flows/about-release-notes.mjs` › "the project and full-changelog links leave
  through app:openExternal and open no app window" (recorded URLs from D6's harness gate,
  `electronApp.windows().length` unchanged)
- AC4 → e2e `scripts/flows/about-release-notes.mjs` › "About says when it last checked, checks now
  on demand and shows the outcome" — plus unit
  `src/renderer/src/components/about/UpdateCheckRow.test.tsx` › "never checked, a timestamp, a
  failure reason and an in-flight check each render their own line"
- AC5 → e2e `scripts/flows/about-release-notes.mjs` › "an update without notes and a failed check
  each render a readable empty state" — plus unit
  `src/renderer/src/components/about/AboutPanel.test.tsx` › "a version with no changelog section
  renders the empty-state sentence" and unit `src/main/lib/release-notes.test.ts` › "an unknown
  version resolves to null"
- AC6 → unit `src/shared/release-notes.test.ts` › "raw HTML in a release body survives only as
  literal text and never as structure" — plus e2e
  `scripts/flows/about-release-notes.mjs` › "the seeded injection probe renders as text and produces
  no img element"

No `manual residue` in this story.

**Named gap (not a residue, not downgraded):** the *real network* outcome of a manual check cannot
run inside `ui:verify`/`ui:flow`, because [[097]] AC5 forbids any check in a dev/unpackaged build —
which is exactly what the harness launches. The flow therefore proves the surface (button, in-flight
state, outcome line, seeded timestamp and seeded failure reason) and the dev-build outcome; the
network behaviour of the check itself is [[097]]'s own acceptance, not 099's. Nothing here becomes a
manual step.

### Coverage gate

| AC | Deliverable | Test |
| --- | --- | --- |
| AC1 | D2 + D3 | e2e `about-release-notes.mjs` + `src/main/lib/release-notes.test.ts` |
| AC2 | D4 | e2e `about-release-notes.mjs` + `AboutPanel.update.test.tsx` |
| AC3 | D3 + D6 | e2e `about-release-notes.mjs` (recorded URLs) |
| AC4 | D5 | e2e `about-release-notes.mjs` + `UpdateCheckRow.test.tsx` |
| AC5 | D2 + D3 + D4 | e2e `about-release-notes.mjs` + `AboutPanel.test.tsx` + `release-notes.test.ts` |
| AC6 | D1 + D3 + D7 | `src/shared/release-notes.test.ts` + e2e `about-release-notes.mjs` |

## Done

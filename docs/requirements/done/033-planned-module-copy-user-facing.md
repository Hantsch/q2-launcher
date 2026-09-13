---
id: 033
title: Planned-module screens explain the feature, not the engineering
status: done
created: 2026-08-21
---

## Requirement

`PlannedModuleView` ([src/renderer/src/views/PlannedModuleView.tsx](../../src/renderer/src/views/PlannedModuleView.tsx)),
shown today for Mods and Assets, already carries a "Planned" badge but otherwise reads like an
internal engineering ticket: a generic "{{module}} is not built yet" heading, a "What this module
will need" section that lists raw architecture capability tokens (translated, but still things
like "Write files inside an installation", "Long-running jobs with progress and cancel"), and a
literal `id: mods · route: /mods · ipc: module:mods` debug line at the bottom
(`module.planned.*` keys in
[src/renderer/src/i18n/locales/en.json](../../src/renderer/src/i18n/locales/en.json)).

A user landing on Mods or Assets should immediately understand, in plain language, what that
part of the launcher is for and what will eventually be possible there — not read a capability
checklist meant for the people building it. "Planned for the future" should stay clearly visible
(the badge already does this; strengthen the wording if needed), but the capability list and the
id/route/ipc line are implementation detail that does not belong in front of a user.

## Acceptance Criteria

- [x] Mods and Assets planned screens show a short, plain-language description of what the
      module is for and what it will let the user do — no engineering/capability terms.
- [x] The "planned for the future" status stays unambiguous (badge and/or heading wording).
- [x] The capability list (`module.planned.capabilities` / `module.planned.capability.*`) and
      the `id / route / ipc` debug line are removed from what a user sees. If that information
      is still useful during development, it may be gated behind a dev-only flag instead of
      deleted outright — but the default build must not show it.
- [x] `module.mods.description` / `module.assets.description` (and `module.install.description`
      if it still renders anywhere) are reviewed and rewritten if they read as technical rather
      than descriptive.
- [x] `npm run ui:verify` screenshots of the Mods and Assets screens reflect the new copy.

## Open Questions

_None._

## Decisions (Sprint)

- **Per-module copy lives in the manifest as new optional key fields** (`plannedIntroKey`,
  `plannedHighlightKeys`) instead of convention-built `module.planned.<id>.*` strings — mirrors
  the existing `titleKey`/`descriptionKey` pattern, keeps prose in i18n, and makes a missing
  entry a compile-time concern rather than a runtime key leaking into the UI.
- **`capabilities` stays on `ModuleManifest`, only its rendering goes** — it is an architecture
  contract (the host refuses a module whose capabilities it cannot serve,
  `src/shared/types/module.ts:21`), not display data; the then-unused
  `module.planned.capability.*` strings are deleted.
- **The `id / route / ipc` line is dev-gated, not deleted** (`import.meta.env.DEV`) — the AC
  allows either, and `ui:verify` drives a production build (story 037's decision), so the
  default build and every screenshot stay clean while the info survives for development.
- **Scope includes the Downloads (ex-Install) planned screen**, not just Mods/Assets — it renders
  the same `PlannedModuleView`, and AC4 explicitly asks about `module.install.description`.
  Story [[031]] renames that module to `downloads` before this story builds, so this story uses
  the post-031 id and keys.
- **The `ui:verify` screen registry gains `mods`, `assets`, `downloads` entries here** — AC5
  wants screenshots of screens the registry does not contain today (14 route/tab entries, no
  planned module), and story [[037]] only closes the dialog blind spots.
- **New copy is `en.json` only** — `en` is the single shipped locale; there is no other bundle to
  keep in sync, and the main process is not involved (no prose crosses IPC here).
- **No new colours, spacing or primitives** — reuse `Panel`, `SectionLabel`, `Badge` and the
  existing `text-ink-*` tokens; a copy story must not introduce token drift
  (`/design-tokens`, `/frontend-guidelines`).

## Plan

Copy + presentation only. No IPC, no main-process change.

1. **Manifest fields** (`src/shared/types/module.ts`): add two optional fields to
   `ModuleManifest` — `plannedIntroKey?: string` and `plannedHighlightKeys?: readonly string[]`
   — and fill them for the three `planned` manifests (`downloads`, `mods`, `assets`; ids per
   story 031). `capabilities` untouched.
2. **Copy** (`src/renderer/src/i18n/locales/en.json`): reword `module.planned.title` / `.body`
   so "planned for a later release" is unmistakable in plain words; add `module.planned.outlook`
   (section label) plus `module.planned.<id>.intro` and `module.planned.<id>.highlight.1..n` for
   downloads/mods/assets; rewrite `module.mods.description`, `module.assets.description`,
   `module.downloads.description` into plain user-facing one-liners (they also render on
   `HomeView.tsx:73`).
3. **View** (`src/renderer/src/views/PlannedModuleView.tsx`): replace the capability `<ul>` with
   the intro paragraph + highlight list driven by the new manifest keys (render nothing when a
   manifest has neither); wrap the `id / route / ipc` line in `import.meta.env.DEV`; update the
   file's doc comment. Delete the dead `module.planned.capabilities` /
   `module.planned.capability.*` keys.
4. **Harness** (`scripts/lib/screens.mjs`, `docs/UI-VERIFICATION.md`): add `mods`, `assets`,
   `downloads` screens (variant `populated`, `BOTH_VIEWPORTS`, `navigate` clicks the module's
   nav test-id) and correct the "14 screens" figure in `docs/UI-VERIFICATION.md:111`.
5. Verify: `npm run typecheck`, `npm run build`, `npm test`, then
   `npm run ui:verify -- --screens=mods,assets,downloads`.

Order: D1 → D2 → D3 (D2 needs D1's keys; D3 screenshots the finished copy).

## Deliverables

### D1 — Plain-language copy + manifest copy keys

- Files: `src/shared/types/module.ts`, `src/renderer/src/i18n/locales/en.json`
- Add `plannedIntroKey?` / `plannedHighlightKeys?` to `ModuleManifest`, filled for the
  `downloads`, `mods` and `assets` manifests. Pattern to mirror: the existing
  `titleKey` / `descriptionKey` fields in the same file.
- Add the new `module.planned.*` copy (title/body reworded, `outlook` section label, per-module
  intro plus 3–4 highlights each). Rewrite `module.mods.description`,
  `module.assets.description` and `module.downloads.description` as plain descriptions of what
  the section is for.
- Copy rules: no capability or architecture vocabulary (no "write files inside an installation",
  "long-running jobs", "cvar schema", "IPC", "module"); each highlight is one short thing the
  user will be able to do.
- Acceptance: `npm run typecheck` green; the keys exist and read as product copy; nothing is
  removed yet, so the running app is unchanged.

### D2 — PlannedModuleView shows the outlook, not the checklist

- Files: `src/renderer/src/views/PlannedModuleView.tsx`,
  `src/renderer/src/i18n/locales/en.json` (delete the dead keys)
- Second panel renders `plannedIntroKey` as a paragraph plus `plannedHighlightKeys` as the
  bullet list, keeping the existing `Panel` / `SectionLabel` / `Circle` bullet markup and
  `text-ink-dim` tokens; renders nothing extra when a manifest carries neither key.
- `id / route / ipc` line wrapped in `import.meta.env.DEV`.
- Remove `module.planned.capabilities` and `module.planned.capability.*` from `en.json`; leave
  `ModuleManifest.capabilities` in place.
- Acceptance: `npm run typecheck`, `npm test` and `npm run build` green; in the running app the
  Mods/Assets/Downloads screens show badge + plain intro + highlights, with no capability list
  and no `id: … route: … ipc: …` line in the production build; a grep for
  `planned.capability` under `src/` comes back empty.

### D3 — Planned screens enter the ui:verify registry

- Files: `scripts/lib/screens.mjs`, `docs/UI-VERIFICATION.md`
- Add three entries mirroring the existing `settings` entry (`{ id, variant: 'populated',
  viewports: BOTH_VIEWPORTS, navigate }`) for `mods`, `assets` and `downloads`; navigate via the
  module's nav test-id (`nav-<moduleId>` convention documented at `scripts/lib/screens.mjs:19`;
  Downloads uses the right-cluster button test-id story 031 leaves behind).
- Correct the screen-count sentence in `docs/UI-VERIFICATION.md:111`.
- Acceptance: `npm run ui:verify -- --screens=mods,assets,downloads` completes; three fresh
  screenshots per viewport show the new copy, and their axe entries report zero critical and
  zero serious violations.

## Model Hints

- D1 → default (copy plus two optional type fields)
- D2 → default (single view file, no logic beyond a dev guard)
- D3 → default (three registry entries following an existing pattern)
- Review: → default — a copy/presentation change in one view plus a locale file and a script
  registry; no IPC, no main process, no state, so the regression surface is a wrong key or a
  leftover string, both visible in the diff.

## Test Plan (manual acceptance)

1. `npm run build` (production mode), then start the app.
2. Open **Mods**, **Assets** and **Downloads** from the nav in turn. For each: the "Planned"
   badge is there and the panel wording makes "planned for a later release" unmistakable; the
   intro reads as plain product language; the highlights say what you will be able to do; there
   is **no** "What this module will need" list and **no** `id: … · route: … · ipc: …` line.
3. Open **Home** and read the Mods/Assets/Downloads tiles — the descriptions read as plain
   descriptions, not engineering terms.
4. `npm run dev` and revisit one planned screen — the `id / route / ipc` line is back, so the
   dev-only gate works.
5. `npm run ui:verify -- --screens=mods,assets,downloads`, then look at the three new
   screenshots in `.ui-verify/` — they show the new copy, and the axe entries report no
   critical or serious findings.

## Done

**Summary:** `PlannedModuleView` now shows plain-language product copy — a reworded
"coming in a later release" title/body, a "What's coming" section with a per-module intro
paragraph and 3 highlights — instead of the raw capability checklist. The `id / route / ipc`
debug line is gated behind `import.meta.env.DEV`, so it's gone from production builds but
still available in `npm run dev`. `ModuleManifest` gained `plannedIntroKey?` /
`plannedHighlightKeys?`, filled for `downloads`/`mods`/`assets`; `module.mods.description`,
`module.assets.description` and `module.downloads.description` were rewritten as plain
one-liners (these also render on the Home tiles). The dead `module.planned.capabilities` /
`module.planned.capability.*` keys were deleted. `ui:verify`'s screen registry gained `mods`
and `assets` entries (`downloads` already existed from story 031); the stale "14 screens"
count in `docs/UI-VERIFICATION.md` was corrected to 15.

**Commit message:**
```
033: rewrite planned-module copy in plain language, drop capability checklist
```

**Verification:**
- `npm run typecheck` — green
- `npm run build` — green
- `npm test` — 51 files / 932 tests passed
- `npm run ui:verify -- --screens=mods,assets,downloads` — PASS, 6/6 screenshots (2
  viewports × 3 screens), 0 critical/serious/moderate/minor axe violations
- Clean-agent review — verdict PASS, no blocking findings (one non-blocking style note:
  a `p-4`→`px-1` padding tweak on the now-unwrapped dev-only debug line, harmless)

**Decisions:**
- `downloads`'s `nav-downloads` test-id was already wired into the ui:verify registry by
  story 031's D4 — this story only needed to add the `mods` and `assets` entries.
- `module.install.description` no longer existed (story 031 already renamed it to
  `module.downloads.description`) — AC4's "if it still renders anywhere" branch is N/A.

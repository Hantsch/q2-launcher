---
id: 231
title: i18n keys are referenced, not duplicated, and live with their module
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want every locale key to be proven used, repeated labels to exist once, and
a module's strings to live next to the module's code, so that a wording fix is one edit, a second
locale does not translate dead keys, and a module owns its strings the way it owns its code.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F62):
`src/renderer/src/i18n/locales/en.json` is 3,614 lines, 2,398 leaf keys, 38 namespaces (`config`
alone 1,006). 196 distinct values appear under more than one key (518 keys: "Name" x26,
"Cancel" x12, "Map" x10, "Rename…" x6) while `common.*` has 29 keys; ~25 keys are dead after
discounting plurals (`app.crash.*`, `config.preservedLines.*`, `config.validation.count/subject.*`,
`units.*`). The only test is the vocabulary word filter; missing keys warn only in DEV.

Priority P3; the key-usage test (AC1) is cheap and can ride with story 204's error-key test.

## Acceptance Criteria

- [x] **AC1** — `src/renderer/src/i18n/keys.test.ts` asserts every leaf key is referenced
      literally in `src/` or matches an allowlisted dynamic prefix (each prefix with a comment
      naming its call site); the ~25 dead keys are deleted; the test fails on an unreferenced key.
- [x] **AC2** — Repeated action and label values are consolidated into `common.action.*` /
      `common.label.*`; a duplicate-value test fails when a value appears under more than one key
      outside an allowlist of deliberate exceptions (with reasons).
- [x] **AC3** — Locale files are split into `src/renderer/src/modules/<id>/locale/en.json` plus
      `src/renderer/src/i18n/locales/en.shell.json`, deep-merged in `initI18n`; the merged result
      is identical to today's bundle (snapshot test); "Adding a module" names the locale file as a
      step.
- [x] **AC4** — Every flow and the vocabulary test pass; `ui:a11y` reports no new missing-label
      findings.

## Open Questions

- [x] **Q1** — Does splitting the bundle change the i18next load path for the cinema window,
      which has its own renderer entry?
      **Answered:** no. `src/renderer/src/cinema/main.tsx` calls the same `initI18n` as
      `main.tsx`; the merge happens inside the i18n layer (`i18n/bundle.ts`), so both entries get
      the identical merged bundle, statically imported as today. Proven by `i18n/index.test.ts`
      › "initI18n resolves a key from the shell file and from every module locale".

## Decisions (Sprint)

- **D-a — "Referenced" means a production `.ts`/`.tsx` file under `src/` (tests excluded)
  contains the full key, or its plural base (`_zero|_one|_two|_few|_many|_other` stripped), as
  text.** Reason: a key only a test mentions is still dead in the product.
- **D-b — A dynamic prefix is allowlisted only if it has ≥2 segments, ends in `.`, matches ≥1 key,
  and the prefix text itself occurs in production source; each entry carries a comment naming its
  call site.** Reason: makes the "allowlist `config.` and pass" shortcut fail structurally.
- **D-c — Dead keys are whatever the AC1 test reports after the honest prefix allowlist, not the
  review's ~25 list.** Reason: the review count was a spot estimate (the probe on 2026-10-03
  shows `common.add/remove/back/…` and `units.*` unreferenced too); the test is the authority.
- **D-d — Consolidation is by role, not by spelling: a value is merged into `common.action.*`
  (verbs on buttons/menus) or `common.label.*` (nouns/column headers/field labels) only where the
  role is the same; homonyms ("Update" verb vs noun) stay separate as reasoned exceptions.**
  Reason: a second locale translates a verb and a noun differently, which is exactly what AC2's
  "deliberate exceptions" exist for.
- **D-e — Keys inside an AC1 dynamic family (looked up as `prefix.${id}`) are exempt from the
  duplicate test via their prefix entry.** Reason: pulling one member out of an id-keyed family
  breaks the lookup; the family is the deliberate exception.
- **D-f — The existing flat `common.*` action/label keys move into `common.action.*` /
  `common.label.*`; the rest of `common.*` (e.g. `dateRange`) stays.** Reason: one shape for
  shared words, not two.
- **D-g — Key renames are done by a throwaway codemod script in the scratchpad (not committed)
  that rewrites `en.json` and every literal occurrence in `src/` and `scripts/`.** Reason: ~500 key
  references across main/shared/renderer/tests; hand edits would miss some.
- **D-h — Namespace → file mapping:** `config`, `layer` → `modules/config`; `servers` →
  `modules/servers`; `replays` → `modules/replays`; `mods` → `modules/mods`; `home` →
  `modules/home`; `downloads`, `bootstrap`, `bootstrapWizard`, `retailUpgrade`, `engineUpdate`,
  `repair` → `modules/downloads`; everything else (incl. `common`, `library`, `module`,
  `installation(s)`, `validation`, `jobs`, `appUpdate`, …) → `i18n/locales/en.shell.json`.
  Reason: a namespace goes to the module whose renderer code is its user; `library.*` is read by
  the shell's `LibraryView`, so it stays shell (main-process users don't count — main only sends
  keys).
- **D-i — Module locales reach the shell through a new modules root file
  `src/renderer/src/modules/locales.ts` with static JSON imports, added to the architecture
  test's renderer `rootFiles`.** Reason: the shell may import only modules root files; static
  imports keep the import scanner honest, unlike `import.meta.glob`; a separate root file keeps
  the cinema entry from pulling in every module view via `modules/index.ts`.
- **D-j — The merge is a pure deep merge that throws on a leaf collision.** Reason: namespaces are
  disjoint by D-h, so a collision is a mistake, never an override.
- **D-k — The AC3 snapshot is a committed file snapshot
  (`src/renderer/src/i18n/__snapshots__/en.bundle.json`, `toMatchFileSnapshot`) written from the
  single `en.json` before the split and left untouched by the split.** Reason: AC3 wording; it also
  makes every future string change a visible diff (`vitest -u` is the deliberate act).
- **D-l — Tests and flows that read `en.json` switch to the merged bundle (`i18n/bundle.ts`); the
  two replays flows read `modules/replays/locale/en.json` directly.** Reason: they only read
  `replays.*` keys, so no merge copy in `.mjs` is needed.
- **D-m — AC4's a11y criterion is checked by diffing `npm run ui:a11y`'s `a11y.json`
  label-class findings (`label`, `button-name`, `link-name`, `aria-input-field-name`,
  `select-name`) before D1 and after the last D.** Reason: "no new findings" is a delta, not an
  absolute.
- **D-n — No changelog entry.** Reason: nothing user-visible changes; all values are identical.

## Plan

Order: prove usage → consolidate → split. Splitting last moves only the final keys.

1. **AC1 (D1):** `i18n/keys.test.ts` — leaf keys vs production-source text, plus a documented
   dynamic-prefix allowlist (D-a/D-b). Delete every key it reports as dead (D-c).
2. **AC2 (D2, D3):** duplicate-value test in the same file with a reasoned exception list
   (D-d/D-e). Codemod (D-g) renames repeated action values into `common.action.*` (D2), then
   label values into `common.label.*` (D3), moving the flat `common.*` keys too (D-f).
3. **AC3 (D4, D5):** first introduce `i18n/bundle.ts` (still = `en.json`) and repoint every
   consumer to it (D4); then split into `en.shell.json` + six module locale files, merged by
   `bundle.ts` through `modules/locales.ts`, guarded by the pre-split file snapshot; update
   ARCHITECTURE "Adding a module" step 5 (D5).
4. **AC4:** vocabulary test and all flows stay green; a11y label findings diffed (D-m) — checked
   at the end of D5.

Affected: `src/renderer/src/i18n/{index.ts,bundle.ts,keys.test.ts,bundle.test.ts,index.test.ts,
locales/}`, `src/renderer/src/modules/locales.ts`, `src/renderer/src/modules/<id>/locale/en.json`
×6, `src/architecture.test.ts`, ~26 test files importing `en.json`, two replays flows,
`docs/ARCHITECTURE.md`, plus every file holding a renamed key literal (codemod, D2/D3).

## Deliverables

- **D1 — Every locale key is proven used; dead keys are gone.** Create
  `src/renderer/src/i18n/keys.test.ts`. Collect leaf keys of
  `src/renderer/src/i18n/locales/en.json`; read every production `.ts`/`.tsx` under `src/`
  (exclude `*.test.*`); a key is used if the source text contains the key or its plural base
  (strip `_zero|_one|_two|_few|_many|_other`). Otherwise it must start with an entry of an
  exported `DYNAMIC_KEY_PREFIXES` array — each entry a prefix ending in `.`, ≥2 segments, with a
  `//` comment naming the call site file (e.g. `` t(`servers.detail.rules.${id}`) `` in
  `…/ServerRulesPanel.tsx`). Find the dynamic call sites by searching for template literals and
  string concatenation that build keys (≈49 `` t(`ns.…${ `` sites, plus keys built in main/shared
  — catalogs, `validation.fix.${id}`, `repair.offer.${id}`, `runner.kind.${k}`, sort columns,
  gamemodes, `config.actionCatalog.${id}` …). Probe on 2026-10-03: 346 of 2,400 keys are not
  literally referenced; most are dynamic families. Tests: › "every leaf key is referenced
  literally or under an allowlisted dynamic prefix" (failure lists offenders); › "every dynamic
  prefix occurs in production source and covers at least one key" (rejects prefixes with <2
  segments). Then delete from `en.json` every key the first test still reports (expected incl.
  `app.crash.*`, `config.preservedLines.*`, `config.validation.count/subject.*`, `units.*`) —
  but before deleting, grep each candidate's last segment once to be sure no concatenation
  builds it; a wrongly deleted key renders as a raw key at runtime and no unit test sees it.
  Files: `keys.test.ts` (new), `locales/en.json`. Run `npm run ui:a11y` once **before** editing
  and keep a copy of `a11y.json` in the scratchpad (baseline for D5).

- **D2 — Repeated action values exist once, under `common.action.*`, and a test keeps it so.**
  Add to `src/renderer/src/i18n/keys.test.ts`: › "no value appears under more than one key
  outside the exception list" — group leaf values of `en.json` by exact string; a group of ≥2
  keys fails unless (a) all its keys are plural siblings of one base, (b) the key lies under an
  entry of `DYNAMIC_KEY_PREFIXES` (an id-keyed family stays whole), or (c) the value is in an
  exported `DUPLICATE_EXCEPTIONS: Record<string, string>` (value → one-sentence reason, e.g.
  homonym "Update" verb vs noun, or the same word in a different grammatical role). Plus
  › "every duplicate exception still matches a duplicated value" (stale guard). Consolidate
  every repeated **action** value (button/menu verbs: Cancel, Remove, Rename…, Save, Add, Update
  (verb), Clear, Close, Back, Play, Install, …) into `common.action.<camelCase>`; existing flat
  `common.*` action keys (`common.cancel`, …) move there too. Do the renames with a throwaway
  Node codemod in the scratchpad (not committed): a map old key → new key; rewrite `en.json`
  (add the new key, delete the old ones) and replace the quoted literal `'old.key'`/`"old.key"`
  /`` `old.key` `` in every file under `src/` and `scripts/` (tests included). Never rename a key
  under a `DYNAMIC_KEY_PREFIXES` entry. Repeated **label** values are not done here: list them
  in `DUPLICATE_EXCEPTIONS` inside one block commented `// D3 of story 231 consolidates these`
  so the test is green. Files: `keys.test.ts`, `locales/en.json`, and the call sites the codemod
  rewrites (renderer components, main/shared key literals, tests, flows). Verify with
  `npm test`, `npm run typecheck`, `npm run lint`.

- **D3 — Repeated label values exist once, under `common.label.*`.** Using the same scratchpad
  codemod approach as D2 (old key → new key map; rewrite `src/renderer/src/i18n/locales/en.json`
  and every quoted literal of the old key under `src/` and `scripts/`, tests included; never
  touch keys under a `DYNAMIC_KEY_PREFIXES` entry in `src/renderer/src/i18n/keys.test.ts`),
  consolidate repeated **label** values (nouns, column headers, field labels: Name, Map, Mod,
  Players, Unknown, None, Settings, Ping, Engine, Password, Favourite, Gamemode, Demos, …) into
  `common.label.<camelCase>`; the remaining flat `common.*` label keys (`common.unknown`, …) move
  there too; non-action/non-label `common.*` (e.g. `dateRange`) stay. A value used in two
  different roles (e.g. a noun header and a verb button) is not merged — give it a
  `DUPLICATE_EXCEPTIONS` entry with its reason. Acceptance: the block commented
  `// D3 of story 231 consolidates these` in `keys.test.ts` is deleted; every remaining
  `DUPLICATE_EXCEPTIONS` entry has a reason; › "no value appears under more than one key outside
  the exception list" and both D1 tests pass. Files: `keys.test.ts`, `locales/en.json`, the
  rewritten call sites. Verify with `npm test`, `npm run typecheck`, `npm run lint`.

- **D4 — One import point for the bundle.** Create `src/renderer/src/i18n/bundle.ts` exporting
  `export const en = <import of ./locales/en.json>` (pure: no DOM, no `import.meta`, no
  electron — main/shared tests import it). `src/renderer/src/i18n/index.ts` takes `en` from
  `./bundle`. Repoint every other reader of `locales/en.json` to `bundle.ts`'s `en`: the static
  imports in `src/main/error-keys.test.ts`, `src/main/ipc/index.test.ts`,
  `src/main/modules/replays/index.test.ts`, `src/main/services/update/service.actions.test.ts`,
  `src/renderer/src/i18n/{gamemode-keys,vocabulary,keys}.test.ts`,
  `src/renderer/src/modules/downloads/{components/FailureCauseDetail.test.tsx,report.test.ts}`,
  `src/renderer/src/modules/home/{HomeView,NewsHero}.test.tsx`,
  `src/renderer/src/modules/replays/{NameTemplatesList,ReplaysSettingsSection,ReplaysView}.test.tsx`,
  `src/renderer/src/modules/servers/ServerPlayersPanel.test.tsx`,
  `src/renderer/src/store/useLauncher.update.test.ts`,
  `src/shared/config/comment-labels.test.ts`, `src/shared/launch/userinfo.test.ts`,
  `src/shared/replays/demo-rename.test.ts`, `src/shared/servers/{address,master-records}.test.ts`;
  and the `readFileSync(...en.json)` reads in `src/main/modules/replays/{demo-play,extra-folders,
  file-actions}.test.ts`, `src/main/modules/servers/{master-sources,quick-filter-entries}.test.ts`
  (replace with the import). Re-grep `locales/en.json` afterwards: only `bundle.ts` may remain.
  Purely mechanical, no behaviour change; verify with `npm test`, `npm run typecheck`,
  `npm run lint`.

- **D5 — Strings live with their module; the merged bundle is unchanged.** Order matters:
  (1) create `src/renderer/src/i18n/bundle.test.ts` › "the merged bundle matches the pre-split
  snapshot" — `await expect(JSON.stringify(en, null, 2) + '\n').toMatchFileSnapshot(
  './__snapshots__/en.bundle.json')` — and run it once **while `en.json` is still one file** to
  write the snapshot; do not regenerate it after step 2. (2) Split
  `src/renderer/src/i18n/locales/en.json` by top-level namespace: `config`, `layer` →
  `src/renderer/src/modules/config/locale/en.json`; `servers` → `modules/servers/locale/en.json`;
  `replays` → `modules/replays/locale/en.json`; `mods` → `modules/mods/locale/en.json`; `home` →
  `modules/home/locale/en.json`; `downloads`, `bootstrap`, `bootstrapWizard`, `retailUpgrade`,
  `engineUpdate`, `repair` → `modules/downloads/locale/en.json`; all other namespaces →
  `src/renderer/src/i18n/locales/en.shell.json`; delete `en.json`. (3) New modules root file
  `src/renderer/src/modules/locales.ts` exporting `MODULE_LOCALES_EN` (static JSON imports of the
  six files); add `${RENDERER_MODULES}/locales` to the renderer `rootFiles` list in
  `src/architecture.test.ts` (test "a renderer shell file imports only modules root files…").
  (4) `bundle.ts`: `en = deepMerge(shell, ...MODULE_LOCALES_EN)` with a pure local `deepMerge`
  that throws on a leaf collision (message names the key). `initI18n` is unchanged otherwise; the
  cinema entry uses it too. More tests in `bundle.test.ts`: › "a leaf collision between locale
  files throws"; › "every module locale file on disk is registered in modules/locales.ts" (list
  `src/renderer/src/modules/*/locale/en.json` with `node:fs`, compare to the registered count);
  › "ARCHITECTURE.md's Adding-a-module names the module locale file" (step 5 text contains
  `modules/<id>/locale/en.json`). In `src/renderer/src/i18n/index.test.ts` add › "initI18n
  resolves a key from the shell file and from every module locale". (5) Point
  `scripts/flows/replays-cinema-unavailable.mjs` and `replays-stage-unavailable.mjs` at
  `src/renderer/src/modules/replays/locale/en.json` (they read only `replays.*`). (6)
  `docs/ARCHITECTURE.md` "Adding a module" step 5 → "Strings — `src/renderer/src/modules/<id>/
  locale/en.json`, registered in `src/renderer/src/modules/locales.ts`; shell strings live in
  `src/renderer/src/i18n/locales/en.shell.json`"; update the "Adding a language" comment in
  `i18n/index.ts` (a language = `xx.shell.json` + one `xx.json` per module locale). (7) Finish
  with `npm run ui:flows` and `npm run ui:a11y`; diff the label-class findings (`label`,
  `button-name`, `link-name`, `aria-input-field-name`, `select-name`) against the baseline
  `a11y.json` D1 saved — no new ones. Files: `bundle.ts`, `bundle.test.ts`, `index.ts`,
  `index.test.ts`, `en.shell.json` (new), six module `locale/en.json` (new), `modules/locales.ts`
  (new), `architecture.test.ts`, two flows, `docs/ARCHITECTURE.md`.

## Model Hints

- D1 → deliverable-hard — ~320 of the 346 literally-unreferenced keys are built dynamically
  across main, shared and renderer (template literals, concatenation, catalog ids), and
  misclassifying one deletes a live string that only surfaces as a raw key at runtime, which no
  unit test renders.
- D2, D3, D4, D5 → default (codemod-driven renames and a mechanical split, both guarded by the
  tests and the pre-split snapshot).

Review: → default

## Acceptance Tests

- AC1 → unit `src/renderer/src/i18n/keys.test.ts` › "every leaf key is referenced literally or
  under an allowlisted dynamic prefix" and › "every dynamic prefix occurs in production source
  and covers at least one key" (D1)
- AC2 → unit `src/renderer/src/i18n/keys.test.ts` › "no value appears under more than one key
  outside the exception list" and › "every duplicate exception still matches a duplicated value"
  (D2 adds, D3 completes)
- AC3 → unit `src/renderer/src/i18n/bundle.test.ts` › "the merged bundle matches the pre-split
  snapshot", › "a leaf collision between locale files throws", › "every module locale file on
  disk is registered in modules/locales.ts", › "ARCHITECTURE.md's Adding-a-module names the
  module locale file"; unit `src/renderer/src/i18n/index.test.ts` › "initI18n resolves a key from
  the shell file and from every module locale" (also answers Q1); unit `src/architecture.test.ts`
  › "a renderer shell file imports only modules root files or an allowlisted edge" (D5)
- AC4 → unit `src/renderer/src/i18n/vocabulary.test.ts` (all tests, now on the merged bundle);
  e2e `replays-stage-unavailable` and `replays-cinema-unavailable` (the two flows that read a
  locale file); e2e-all `npm run ui:flows`; `npm run ui:a11y` label-class findings diffed against
  D1's baseline (D-m) (D5)

## Done

Every locale key is proven used (keys.test.ts, 49 commented dynamic prefixes; dead keys deleted), repeated
action/label values live once under common.action.* / common.label.* (23 reasoned DUPLICATE_EXCEPTIONS), and locales
are split into en.shell.json + six modules/<id>/locale/en.json merged by bundle.ts (deepMerge throws on collision).

Commit message: `231: i18n key-usage + duplicate-value tests, common.action/label consolidation, per-module locale files`

Verification (narrow gate): build, typecheck, lint green; `npx vitest run --changed HEAD` 368 files / 5049 tests green; `npm run ui:flow -- replays-stage-unavailable` and `replays-cinema-unavailable` OK; ui:a11y label-class findings 0 before and after. Full `ui:flows` left to the sprint gate. AC1-AC4 map to keys.test.ts, bundle.test.ts, index.test.ts, architecture.test.ts, vocabulary.test.ts as listed in Acceptance Tests; all passed. No manual residue. Review: default stage PASS.

Decisions:
- Dead keys are what the test reports (~100 deleted), not the review's ~25 (D-c).
- en.json held duplicate JSON keys (ipc, ipc.error, installation.source); shadowed earlier blocks are dropped by splitting the parsed object, merged result unchanged.
- Snapshot compares key-sorted JSON (namespaces interleave, a shell-first merge reorders text); content pinned either way.
- Same-role merges beyond labels: servers.sources.reject.* folded into servers.address.reject.*; related tests widened their key-prefix assertions.
- Dropped assertions on two dead keys (library.column.engine, replays.unreadable.playDisabled).
- keys.test.ts/bundle.test.ts live in the node tsconfig project (fs); architecture exclude list and tsconfig includes updated.
- Unfixed minor: ~13 flow comments and scripts/lib/fixture/installations.mjs still say "mirrors locales/en.json"; four comments name the deleted downloads.error.manifestUnavailable.

tiers: D 5 / hard 1 · review default · cycles 0 · agents 7

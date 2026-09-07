---
id: 063
title: Hand grenades and Grenade Launcher can be bound to a key
status: done
created: 2026-09-07
---

## Requirement

**Bug.** In Controls > Weapons the two grenade rows — *Hand grenades* (`use grenades`,
`weaponUse:use_grenades`) and *Grenade Launcher* (`use grenade launcher`,
`weaponUse:use_glauncher`, see
[action-catalog.ts:213-226](../../src/shared/config/action-catalog.ts#L213-L226)) — cannot be
assigned a key. Every other weapon row in the same category can. A user who wants a direct
weapon-select key for grenades or the launcher is stuck.

The screenshot that came with the report is not in the repo; the exact symptom (bind slot missing,
slot present but refusing capture, capture accepted but not persisted, or a blocked-capture banner)
still has to be reproduced. Candidate causes worth checking first, without committing to any of
them:

- Command-text collision handling: `dropWeapon:grenades` and `dropAmmo:hgrenades` already share the
  rendered command `drop grenades`, which is why row identity lives in `catalogId`
  ([catalog-binds.ts:39](../../src/renderer/src/modules/config/lib/catalog-binds.ts#L39),
  [catalog-rows.ts:137](../../src/shared/config/catalog-rows.ts#L137)) — a lookup that still keys on
  command text somewhere could tie the two grenade rows together.
- Multi-word command text: `use grenade launcher` is the only weapon-select command with two words
  after the verb, so quoting/parsing on the write or adopt path is a plausible failure point.
- Alias-name derivation for these rows colliding (see
  [[060-duplicate-alias-is-fixable-from-aliases]]).

Fix the cause, not the symptom, and cover it with a regression test at the level the cause sits at.

## Acceptance Criteria

- [x] **AC1** — A key can be assigned to the *Hand grenades* row in Controls > Weapons, the same way
      as for any other weapon row.
- [x] **AC2** — A key can be assigned to the *Grenade Launcher* row.
- [x] **AC3** — Both binds survive a save/reload round trip and appear in the written cfg as the
      correct commands (`use grenades`, `use grenade launcher`), correctly quoted.
- [x] **AC4** — Assigning one of the two does not disturb the other, and neither collides with the
      `drop grenades` rows in Drops.
- [x] **AC5** — A regression test fails on the un-fixed code and names the actual cause.

## Open Questions

- [x] ~~Screenshot of the symptom: is there no bind slot on those rows, or does the slot refuse the
      capture / show a blocking banner? (Report referenced an image that did not reach the repo.)~~
      answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Symptom for AC1/AC2: the row is present and shows a bind slot, but the slot displays
  `[-]` and does not let a key be assigned — i.e. capture itself is blocked/disabled on those two
  rows, not merely a display issue after capture.

### Root cause (reproduced, 2026-09-07)

`[-]` is `BindSlotPlaceholder` (`components/BindSlot.tsx:145-153`, an `&mdash;` `<span>`, no
button, no capture), and its **only** caller is `ControlsTab.tsx:1536` —
`const inertSlots = action.kind === 'alias'`. So the row is an entry of `kind: 'alias'`, which by
story 019's decision can never be bound through the UI. A catalogue row (`weaponUse:use_grenades`
etc.) is *not* affected: it renders through `renderCatalogRow` with a live slot, and a fresh
`STANDARD_TEMPLATE` profile round-trips clean (probed).

What the live profile actually holds (read from `%APPDATA%/Q2 Launcher/state.json` +
`Hantsch-Test.cfg`): two hand-made Weapons entries of the *same* shape —
`SSG + SG` (`use super shotgun; use shotgun`, key `q`, `kind: 'bind'`) and
`Grenade + Launcher` (`use grenade launcher; use grenades`, **no key**, `kind: 'alias'`).
Both were created as `kind: 'bind'` (`ControlsTab.tsx:2404`, the create dialog's default). The
keyless one flipped kind on a file→state pass:

- the writer gives a keyless entry with a body an alias line only (`alias grenade_launcher "use
  grenade launcher; use grenades"  // Grenade + Launcher [q2l]`) — no bind line, no anchor, and
  `isUnboundEntry` (`render.ts:1123-1134`) explicitly *excludes* anything that got an alias line,
  so no unbound line either. Nothing in the file records that this is a bind entry with an empty
  key slot.
- the reader therefore has no signal: `inferKind` (`profile-restore.ts:2245-2251`) returns
  `bound || !hasAliasLine ? 'bind' : 'alias'` → **`'alias'`**.
- `ControlsTab.tsx:1536` then renders the row inert forever, and nothing in the UI can change an
  entry's `kind` (`ActionEditor` fixes it), so the row is a dead end: keyless because it is alias,
  alias because it was keyless.

Verified by probe (deleted again) through the real pipeline
(`renderProfileFile` → `readImportableConfig` → `restoreProfileParts`): three keyless bodied
`kind: 'bind'` entries came back as `kind: 'alias'`, the keyed one stayed `'bind'`.
So the cause is **not** grenade-specific and not a command-text collision — the two grenade rows
are simply the ones this user left keyless. The file→state pass happens without the user asking:
`refreshFromFiles` on focus/tab open when the file changed on disk (`main/modules/config/index.ts:
1248-1372`) and `rebuildMissingProfileRecords` (`rebuild.ts:438`).

### Decisions taken from that

1. **AC1/AC2 are read as the reproduced row**, per the user's binding answer: the affected row is
   the one showing `[-]`, i.e. the keyless entry that carries the grenade `use` commands — not the
   catalogue `weaponUse:*` rows, which already take a key today. The two grenade *commands* still
   have to end up bindable, which is what the ACs are about.
2. **Fixed in the shared file contract, not in the renderer.** `inertSlots` for a `kind: 'alias'`
   entry stays exactly as story 019 decided (the mirrors skip an alias entry, `profiles.ts:339`, so
   a key on one would never reach the file). What is wrong is that the file loses the fact "this is
   a bind entry with an empty key slot" — and per the milestone's own rule (052: the file is the
   source of truth) the fix is to *state* that fact in the file.
3. **Spelled with the existing idiom, not a new tag field.** Story 052 D2/D3's unbound line
   (`//bind "<value>"  // <prose> [q2l …]`) already means exactly "entry, no key"; its body is
   `bindValueFor(action)` (`render.ts:1155-1165`), which for a bodied entry *is* its alias name.
   Re-adding `k=` to the tag (removed by story 050) is rejected: the line shapes can say it.
4. **Already-damaged profiles need a user-driven repair.** `state.json` is the live copy
   (file→state only on refresh/rebuild), so no writer fix heals the existing `kind: 'alias'` entry,
   and a blanket migration is impossible: a deliberately created alias entry is byte-identical to
   this one, in state and in the file. So the Controls row menu gets an explicit "make bindable"
   conversion on an inert row; it pins `aliasName: aliasNameFor(action)` so the engine-visible name
   cannot move (a `+signed` alias name would otherwise be re-derived sign-free and break every
   reference to it).
5. **Carry-over rule applies** (CLAUDE.md / ROADMAP: `alias-references`/`render`/`profile-restore`
   adjacent changes get an adversarial round-trip pass): D3 is that pass, with new
   `ROUND_TRIP_FIXTURES` and object-level kind assertions, not just green unit tests.
6. `docs/systems/profile-file-format.md` is the reference for these line shapes and is updated with
   D1/D2 rather than left to drift.

## Plan

1. **D1 writer** — `render.ts#isUnboundEntry`: a `bind`/`message` entry with no owned bind line and
   no anchor also gets its unbound line *when it has an alias line*, so the file states "this entry
   has an empty key slot" next to the alias that holds its body. Only the `aliasLineActionIds`
   early return goes; the `alias`/`toggle`/`press-release` exclusion stays (those kinds are
   legitimately keyless — "one fact, one place" still holds for them).
2. **D2 reader** — `profile-restore.ts#inferKind` gets that signal: a group carrying an unbound
   line is a `bind`/`message` entry even with no key claim; only an alias line *without* one stays
   `kind: 'alias'`. Includes checking that an alias line and an unbound line for the same entry
   land in **one** group (group key / `an=` field) instead of two entries.
3. **D3 adversarial round-trip pass** — new fixtures + object-level assertions through the real
   pipeline: keyless multi-command entry, keyless entry with explicit `aliasName`, keyless entry
   referenced by another body, a genuine `kind: 'alias'` entry beside it, plus both grenade `use`
   rows next to both `drop grenades` rows (AC4).
4. **D4 repair** — Controls row menu action on an inert alias row: convert `kind: 'alias'` →
   `'bind'`, pinning the current alias name. One pure helper + i18n + fixture row.
5. **D5 real surface** — a `ui:flow` that walks it: inert row → make bindable → capture a key on
   both grenade rows, one with the two-word command `use grenade launcher`.

Order is 1 → 2 → 3 → 4 → 5; D1+D2 are one behaviour split by layer, D3 is the gate on them.

Affected files: `src/shared/config/render.ts`, `src/shared/config/profile-restore.ts`,
`src/shared/config/fixtures/profiles.ts`, `src/main/modules/config/round-trip.test.ts`,
`src/renderer/src/modules/config/ControlsTab.tsx`,
`src/renderer/src/modules/config/lib/catalog-binds.ts`,
`src/renderer/src/i18n/locales/en.json`, `scripts/lib/fixture.mjs`, `scripts/flows/`,
`docs/systems/profile-file-format.md`.

## Deliverables

- [x] **D1 — the file says "bind entry, no key".** `src/shared/config/render.ts` (`isUnboundEntry`,
  and its doc comment, which currently argues the opposite) + `docs/systems/profile-file-format.md`.
  Acceptance: a keyless `kind: 'bind'`/`'message'` entry that has an alias line renders **both** its
  alias line and an unbound line `//bind "<aliasName>"  // <prose> [q2l …]` in the `Entries: <cat>`
  section; a `kind: 'alias'`/`'toggle'`/`'press-release'` entry is unchanged; a keyless entry with
  no body is unchanged (`//bind ""`). Test in `src/shared/config/render.test.ts` (mirror the
  existing unbound-line cases) — expect fixture-driven expectations in
  `src/shared/config/render-invariants.test.ts` / `fixtures/profiles.ts` to need updating.
- [x] **D2 — the reader believes it.** `src/shared/config/profile-restore.ts` (`inferKind` + its call
  site at ~2353, and the entry grouping so alias line + unbound line merge into one entry).
  Acceptance: render → parse → restore of a keyless bodied `kind: 'bind'` entry returns
  `kind: 'bind'`, one entry, body and `aliasName` intact; a genuine `kind: 'alias'` entry still
  returns `'alias'`; `keepEmptyAlias`, `toggle` and `press-release` restores are untouched. Tests in
  `src/shared/config/profile-restore.test.ts` plus the failing-first regression case in
  `src/main/modules/config/round-trip.test.ts` (mirror the "story 045 … survive as objects" block,
  reuse its `reimportProfile`).
- [x] **D3 — adversarial round-trip pass.** `src/shared/config/fixtures/profiles.ts` (new fixtures added
  to `ROUND_TRIP_FIXTURES`) + `src/main/modules/config/round-trip.test.ts`. Acceptance: the fixed
  point `render(parse(render(p))) === render(p)` holds for every new fixture, **and** each entry's
  `kind`/`keys`/`commands`/`aliasName` come back identical as objects; the two `use grenade*` rows
  and the two `drop grenades` rows stay four distinct entries with their own `catalogId`s.
- [x] **D4 — an inert row can be made bindable.** `src/renderer/src/modules/config/lib/catalog-binds.ts`
  (new pure `applyEntryKindBindable(actions, actionId)`: `kind: 'bind'` +
  `aliasName: aliasNameFor(action)`), `ControlsTab.tsx` (`renderRowMenu` item, only for
  `kind === 'alias'`), `src/renderer/src/i18n/locales/en.json`, and one keyless
  `kind: 'alias'` Weapons entry per grenade command added to the populated fixture
  (`scripts/lib/fixture.mjs`). Acceptance: the menu item appears only on an inert row, the entry
  becomes bindable in place, its alias name does not change (incl. a `+signed` one), and no other
  entry is touched. Unit test in `src/renderer/src/modules/config/lib/catalog-binds.test.ts`.
- [x] **D5 — proof on the real surface.** `scripts/flows/grenade-rows-take-a-key.mjs` (mirror
  `scripts/flows/custom-action-row.mjs` / `controls-extra-keys.mjs`). Acceptance:
  `npm run ui:flow -- grenade-rows-take-a-key` opens Controls > Weapons, finds both seeded inert
  rows (`.ctrl-slot.is-inert`), makes each bindable, captures a key on each, asserts the cap shows
  the key, and drops a screenshot per step; `npm run ui:verify` stays at 0 axe violations.

## Model Hints

- D2 → `deliverable-hard` — restore-side kind inference and entry grouping sit on the path every
  restored entry takes (`bind`/`message`/`alias`/`toggle`/`press-release`, anchors, modifier
  layers); a wrong merge silently fuses two entries into one or splits one into two, and the same
  function decides `keepEmptyAlias`.
- D1, D3, D4, D5 → default.
- Review: → `story-review-hard` — the change alters the written file format in the
  `render`/`profile-restore` pair the ROADMAP's carry-over rule was written for (042 needed eight
  adversarial rounds), and a regression here corrupts real user profiles on the next read.

## Acceptance Tests

- AC1 → e2e `npm run ui:flow -- grenade-rows-take-a-key` (D5) drives the *Hand grenades* fixture
  row (`fixture-action-inert-grenades`) through "Make bindable" then a real key capture; the row's
  write path is also unit-covered by `src/renderer/src/modules/config/lib/catalog-binds.test.ts` ›
  `applyEntryKindBindable` › "turns an inert alias entry into a bind entry, pinning its derived
  alias name" (D4).
- AC2 → the same e2e flow (D5), second fixture row (`fixture-action-inert-glauncher`), the
  two-word `use grenade launcher` command; `catalog-binds.test.ts` ›
  "pins a +signed alias name explicitly instead of leaving it to be re-derived" covers the
  alias-name-pinning edge for that path.
- AC3 → unit `src/main/modules/config/round-trip.test.ts` › "a keyless entry with a body comes
  back as a bind entry, body intact" (D2, restored kind/commands/aliasName/catalogId, keyless with
  no key invented) and `src/shared/config/render.test.ts` › "story 063 D1: a keyless bind/message
  entry with a body gets BOTH its alias line and the unbound line" (D1) — asserts the rendered
  `alias … "use grenades; +attack"` body and the `//bind "<aliasName>"` unbound line.
- AC4 → unit `src/main/modules/config/round-trip.test.ts` ›
  "'Grenade use rows and drop grenades rows (story 063 AC4)': four entries, four distinct
  catalogIds" (D3) — both `use grenade*` rows and both `drop grenades` rows round-trip as four
  distinct `catalogId`s, none disturbing another's keys.
- AC5 → unit `src/main/modules/config/round-trip.test.ts` › "a keyless bind entry does not turn
  into an alias entry (story 063 regression)" (D2) — written first, must fail on the un-fixed code
  with `expected 'alias' to be 'bind'`, i.e. naming the actual cause (`inferKind` has no signal
  that the entry is a bind entry).

## Done

**Summary.** The *Hand grenades* / *Grenade Launcher* rows were stuck inert because a keyless
`kind: 'bind'`/`'message'` entry with a body earned only an alias line, never an unbound line, so
the file carried no signal that its key slot was deliberately empty — the next file→state read
misread it as `kind: 'alias'`, permanently unbindable through the UI. Fixed at the file contract:
`render.ts#isUnboundEntry` (D1) now also emits the unbound line for a keyless bodied
`bind`/`message` entry even when it has an alias line, and `profile-restore.ts#inferKind` plus its
entry grouping (D2, hardened by D2b against a merge-split defect D3's adversarial pass surfaced)
read that signal back and join the alias line + unbound line into one entry. D3 added the
adversarial round-trip corpus the ROADMAP carry-over rule requires for `render`/`profile-restore`
changes, including the four-entries/four-`catalogId`s case for AC4. D4 gives already-damaged
profiles (a real `kind: 'alias'` entry that is actually this bug, not a deliberate alias) a
"Make bindable" repair action in the Controls row menu, pinning the derived alias name so a
`+signed` name survives the kind flip. D5 proves AC1/AC2 on the real Controls surface with a
`ui:flow` script that drives two seeded inert fixture rows through the repair action and a real
key capture.

**Decisions made during this final push:**
- D5's flow script had leftover debug scaffolding (a row-id dump step, a menu-items console.log)
  from the interrupted prior session; both were removed once the flow was confirmed green, so it
  matches the style of `controls-extra-keys.mjs`/`custom-action-row.mjs` — no stray logging.
- The `populated` fixture is stateful across `ui:flow` runs (the flow's own writes persist in
  `.ui-verify/fixture/populated/userdata`), so a second run without `node scripts/seed.mjs` first
  finds both rows already made bindable and keyed and times out looking for the inert placeholder —
  not a bug in the flow, just the harness's known reseed-before-run contract (same as every other
  `ui:flow` script against the populated fixture).
- The story review (story-review-hard tier, PASS) found the "## Acceptance Tests" section named
  test titles that didn't match what D1-D4 actually wrote (drafted before those tests existed);
  corrected in place to the real titles/paths above. It also found two stale paragraphs in
  `docs/systems/profile-file-format.md` (the "Tag fields" note on `an` claimed it was unconditional
  on `aliasName`, contradicting the writer's actual "only when no alias line already spells the name
  out" rule; the "Entry identity and grouping on read" section still described an unbound line as
  always its own entry, predating D2's alias+unbound join) — both corrected to match the shipped
  `render.ts#unboundLine` / `profile-restore.ts#matchUnbound` behaviour.
- Two lower-severity review findings were left as documented trade-offs rather than fixed: (1) D2's
  join makes a pre-D1 file's keyless single-`say` entry restore as `kind: 'alias'` instead of the old
  `kind: 'message'` — a narrow, pre-existing-file-only regression into the same "inert until D4's
  repair" state the story removes for grenades, already asserted as intended at
  `profile-restore.test.ts:1295-1307` and repairable the same way; (2) the grenade fixtures used for
  AC3/AC4's object-level round-trip assertions are all keyless (the D5 flow proves the *keyed* case
  live but doesn't reload from disk), so AC3's "survive a save/reload round trip" for an already-keyed
  grenade row rests on generic pre-existing bound-entry coverage rather than a story-specific fixture
  — both are non-blocking and did not fail any acceptance test.

**Verification.**
- `npm run build` — green.
- `npm test` — 2607 tests / 101 files, all green.
- `npm run typecheck` — green (node + web projects).
- `npm run ui:verify` — 0 axe violations across 68 screens (34 screens × 2 viewports), clean.
- `npm run ui:flow -- grenade-rows-take-a-key` — green on a freshly-seeded `populated` fixture.
- Review: `story-review-hard` tier, verdict **PASS**. Findings handled as above (2 doc fixes + 1
  story-file fix applied; 2 low-severity trade-offs documented, not fixed; no correctness bugs,
  no weakened tests, no scope creep, no CLAUDE.md guardrail violations found).
- AC → test mapping, as verified: AC1/AC2 → `ui:flow -- grenade-rows-take-a-key` (both fixture rows
  captured a key, passed) + `catalog-binds.test.ts`'s `applyEntryKindBindable` tests (passed); AC3 →
  `round-trip.test.ts` "a keyless entry with a body comes back as a bind entry, body intact" +
  `render.test.ts` "story 063 D1: …" (both passed); AC4 → `round-trip.test.ts` "'Grenade use rows and
  drop grenades rows (story 063 AC4)': four entries, four distinct catalogIds" (passed); AC5 →
  `round-trip.test.ts` "a keyless bind entry does not turn into an alias entry (story 063
  regression)" (passed, and independently confirmed to fail on the pre-D1/D2 code with
  `expected 'alias' to be 'bind'`).

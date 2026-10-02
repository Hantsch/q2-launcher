---
id: 147
title: a broken sidecar is reported, never overwritten
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A sidecar ([[146]]) is a plain file next to the demo: the user may edit it by hand, a newer launcher
version may have written it, a sync tool may have mangled it. Whatever is in there is the user's
data. The launcher reads it **defensively**: a sidecar it cannot read is shown as an error on the
demo — never silently dropped, never overwritten unless the user explicitly saves (concept
`docs/concepts/demo-browser.md` §8.1, DEMO-12).

## Acceptance Criteria

- [x] **AC1** — A sidecar that is not valid JSON marks the demo with a "sidecar error" marker and the
      reason ([[150]] row, [[155]] detail).
- [x] **AC2** — A sidecar with a field that fails the schema marks the demo the same way, naming the
      field.
- [x] **AC3** — A sidecar with an unknown (e.g. newer) `schemaVersion` marks the demo the same way,
      naming the version.
- [x] **AC4** — Scanning, listing, opening the detail view and playing never modify an erroneous
      sidecar (content and modification time unchanged, asserted by a test).
- [x] **AC5** — Saving over an erroneous sidecar happens only after an explicit confirmation that
      names what will be replaced.
- [x] **AC6** — The demo's effective values while its sidecar is broken follow the rule decided in
      Q1.

## Open Questions

- [x] ~~**Q1 — Partial use** — ignore the whole broken sidecar (effective values from content/name
      only), or use its valid fields and flag the rest?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Newer schema** — read-only view of the fields the launcher does understand, or
      nothing?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Partial use: use the sidecar's still-valid fields for effective values and flag the
  rest, rather than discarding the whole file — least data loss when only part of a sidecar is
  corrupt or fails validation.
- Same principle applies to an unknown/newer `schemaVersion` (Q2): show a read-only view of the
  fields the current launcher does understand (those that pass the known schema shape) rather
  than nothing, consistent with the partial-use decision above.
- **Scope is the data layer; the visible marker is [[150]]/[[155]].** This story delivers the
  sidecar state and its issues on every list/detail entry plus the save guard; rendering the marker,
  the reason text and the confirmation dialog belongs to [[150]] AC4 and [[155]] (S27) — the sprint
  goal is "only the minimal surface the stories themselves require", and the AC name those stories
  as the carriers.
- **Partial use is per top-level field.** Each of 146's top-level fields (`name`, `description`,
  `mod`, `gamemode`, `map`, `sides`, `tags`, `favourite`, `rating`, `date`) is validated on its own;
  a failing field is dropped from the values and flagged with the zod issue path (e.g.
  `sides.1.players`), while a partially-bad `sides` array is dropped whole — top-level is the
  granularity 146 defines "fields" at, and half a side is not a meaningful effective value.
- **Unknown top-level keys are an issue** (`unknownField`, naming the key) — saving would silently
  drop them, which is exactly the data loss the confirmation guard exists to prevent.
- **Unknown `schemaVersion`** = missing, non-integer, or not a version this launcher knows (newer or
  otherwise); the file is still read per field against the current shape (read-only use, per the
  Q2 decision), flagged `unknownVersion` naming the version as found.
- **Not valid JSON / not an object** (incl. empty file) contributes no values; the issue carries
  line and column when the parser reports a position. A leading UTF-8 BOM is stripped and is not an
  error — Windows Notepad writes one on hand edits.
- **The reason crosses IPC as keys + params, never prose** (CLAUDE.md): issues are
  `{ kind, key, params }` with `demos.sidecar.issue.*` i18n keys added to `en.json` now, so
  [[150]]/[[155]] only render them.
- **Confirmation is a two-step save contract, not an error.** A save (or 146's clear-everything
  delete) over an existing sidecar whose _current on-disk_ read is erroneous returns
  `{ status: 'needsConfirmation', fileName, issues, fingerprint }` and writes nothing; it proceeds
  only when re-sent with `confirmReplace: <fingerprint>` matching a SHA-256 of the current file
  bytes. The file is re-read at save time, not taken from the index — a sidecar hand-edited while
  the app runs must be caught, and a stale confirmation must not overwrite a file that changed
  after it was shown.
- **AC4's "playing" is proven structurally.** Playback arrives in S28 ([[159]]); a test asserts
  that 146's sidecar write/delete function is imported only by the save handler, so any future
  scan/list/detail/play code that could write a sidecar fails the suite.

## Plan

1. Contract (`src/shared/modules/demos.ts`): `SidecarIssue` (`kind: 'invalidJson' | 'notAnObject'
| 'invalidField' | 'unknownField' | 'unknownVersion' | 'unreadable'`, `key`, `params`), `SidecarState`
   (`{ state: 'none' } | { state: 'ok' } | { state: 'error'; issues }`), and the save result union
   (`saved` | `needsConfirmation`). Save payload gains optional `confirmReplace: string`.
2. Pure reader `readSidecarDefensively(bytes)` in `src/main/modules/demos/sidecar-read.ts` →
   `{ values: Partial<Sidecar>, state }` — per-field validation against 146's schema shape.
3. Wire it into 146's sidecar read path so every index entry / detail response carries
   `sidecarState` and only the valid `values` feed the sidecar layer of the effective values.
4. Guard 146's save/delete: re-read current file, fingerprint, two-step confirmation.
5. Tests: reader unit tests; read-only test against a temp dir (bytes + mtime unchanged after
   scan/list/detail); structural import test; guard tests incl. hand-edit-after-scan and stale
   fingerprint.

Order: D1 → D2 → D3. All main/shared; no renderer code except `en.json` keys (D1).

## Deliverables

- [x] **D1 — Defensive sidecar reader (pure) + contract types + i18n keys.**
      Files: `src/shared/modules/demos.ts` (add `SidecarIssue`, `SidecarState`), new
      `src/main/modules/demos/sidecar-read.ts` + `sidecar-read.test.ts`,
      `src/renderer/src/i18n/locales/en.json` (`demos.sidecar.issue.invalidJson` {line?, column?},
      `.notAnObject`, `.invalidField` {field}, `.unknownField` {field}, `.unknownVersion` {version},
      `.unreadable` {code}). `SidecarIssue.kind` also includes `'unreadable'` (produced by D2's fs
      layer, not by the pure reader).
      Reuse story 146's sidecar zod schema (find it: grep `schemaVersion` under `src/shared/modules/`
      and `src/main/modules/demos/`) — do not duplicate the field schemas; take its object `.shape` and
      `safeParse` each top-level field separately.
      `readSidecarDefensively(bytes: Buffer | string): { values: Partial<SidecarFields>; state:
SidecarState }` rules: strip a leading UTF-8 BOM; empty/whitespace or `JSON.parse` failure →
      one `invalidJson` issue (line/column params when the parser message yields a position), no
      values; parsed non-object/array/null → `notAnObject`, no values; `schemaVersion` missing,
      non-integer or not in the known set → `unknownVersion` {version: raw value as string, or
      `"missing"`}, and continue per-field; each known field: valid → into `values`, invalid →
      `invalidField` {field: first zod issue path joined with `.`, prefixed by the field name}; any
      other top-level key → `unknownField` {field}. No issues → `state: 'ok'`; any → `state: 'error'`
      with all issues (valid values still returned). Pure: no fs, no clock.
      Tests (in `sidecar-read.test.ts`): invalid JSON, empty file, BOM-prefixed valid file, array
      root, one bad field among good ones, bad nested `sides` path, unknown key, newer version with
      valid fields, missing version.

- [x] **D2 — Index/detail carry the sidecar state; reading never writes.**
      Files: 146's sidecar read site in `src/main/modules/demos/` (the service that loads
      `<demo>.json` for the index/detail — find it via the sidecar path helper 146 added), the index
      entry / detail types in `src/shared/modules/demos.ts` (add `sidecarState: SidecarState`), new
      `src/main/modules/demos/sidecar-readonly.test.ts`.
      Replace 146's strict parse with `readSidecarDefensively`; missing file → `{ state: 'none' }`,
      values `{}`; an existing but unreadable file (EACCES, EISDIR…) → `state: 'error'` with one
      `unreadable` {code} issue, values `{}`. Only `values` feed the sidecar precedence layer. Read with `fs.readFile` only; no write, rename,
      touch or `utimes` anywhere on this path.
      Tests: (a) temp dir with one demo per broken kind (invalid JSON, bad field, newer version) plus
      their sidecars; run the module's scan, list and detail handlers; assert each sidecar's bytes and
      `mtimeMs` are unchanged and that entries report `state: 'error'` with the expected issue kinds
      and params (field name, version); (b) partial use: a sidecar with valid `name` + invalid
      `rating` yields `values.name` and no `rating`; a `schemaVersion: 999` sidecar with valid `map`
      yields `values.map`; (c) structural: read every `.ts` under `src/main` and assert 146's sidecar
      write/delete export is imported only by the save handler file (and its test).

- [x] **D3 — Save/delete over a broken sidecar needs a matching confirmation.**
      Files: 146's save handler and its payload schema in `src/main/modules/demos/` (module schemas
      file), `src/shared/modules/demos.ts` (save result union, `confirmReplace?: string` on the save
      payload), new `src/main/modules/demos/sidecar-guard.test.ts`.
      Before writing _or deleting_ (146's clear-everything path), read the current sidecar bytes from
      disk (never the index's cached state), run `readSidecarDefensively`; if the file exists and
      `state === 'error'`: compute `fingerprint = sha256(bytes)` hex; if `confirmReplace` is absent or
      differs → return `ok({ status: 'needsConfirmation', fileName: <sidecar base name>, issues,
fingerprint })` and touch nothing; if it matches → proceed through 146's atomic write unchanged.
      Valid or absent sidecar → behaviour exactly as in 146 (`ok({ status: 'saved' })`).
      Tests: unconfirmed save over each broken kind → needsConfirmation, bytes + mtime unchanged;
      confirmed with matching fingerprint → written; stale fingerprint (file edited between the two
      calls) → needsConfirmation again with the new fingerprint, unchanged; sidecar valid at scan time
      but broken by hand before save → guarded; clear-everything over a broken sidecar → guarded; valid
      sidecar save needs no confirmation (146 regression).

## Model Hints

- D3 → deliverable-hard — it rewires story 146's freshly built atomic write/delete path in the
  same sprint; the guard must re-read and fingerprint the very bytes it replaces, and any slip
  regresses 146's AC2/AC3/AC5 or opens a silent-overwrite window.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/demos/sidecar-read.test.ts` › "invalid JSON yields an invalidJson
  issue and no values" + `src/main/modules/demos/sidecar-readonly.test.ts` › "a broken sidecar
  marks its demo with state error and the reason" (D1, D2). Rendering the marker is [[150]] AC4 /
  [[155]]'s e2e — not a gap of this story (Decisions: data layer).
- AC2 → unit `sidecar-read.test.ts` › "a failing field is flagged by name and the rest is kept"
  (D1) + `sidecar-readonly.test.ts` › "a broken sidecar marks its demo with state error and the
  reason" (D2).
- AC3 → unit `sidecar-read.test.ts` › "an unknown schemaVersion is flagged with the version found"
  (D1) + `sidecar-readonly.test.ts` › same test as AC1 (D2).
- AC4 → unit `src/main/modules/demos/sidecar-readonly.test.ts` › "scan, list and detail leave a
  broken sidecar's bytes and mtime untouched" and › "only the save handler imports the sidecar
  writer" (D2).
- AC5 → unit `src/main/modules/demos/sidecar-guard.test.ts` › "saving over a broken sidecar asks
  for confirmation naming what is replaced", › "a stale confirmation does not overwrite" and ›
  "a sidecar broken after the scan is still guarded" (D3). The confirmation dialog itself is
  [[155]]'s surface.
- AC6 → unit `sidecar-readonly.test.ts` › "valid fields of a broken or newer sidecar still feed
  the effective values" (D2).

## Done

This codebase's actual module is `replays`, not the generic `demos` the story text names — all
paths below are the real ones; the story's `demos/*` paths never existed and are a leftover from
the concept doc's generic naming.

Summary: added a pure defensive sidecar reader (`sidecar-read.ts`) that validates 146's schema
per top-level field, keeping valid fields and flagging the rest with `{kind, key, params}` issues
(never prose, per CLAUDE.md); wired it into `sidecar-store.ts`'s read path so a broken/newer
sidecar is reported, never dropped, and reading never writes; and rewired `write()` (used for both
save and 146's clear-everything delete) so replacing or deleting a currently-broken sidecar
requires a `confirmReplace` SHA-256 fingerprint of the exact on-disk bytes, re-read fresh on every
call so a stale or hand-edited-since confirmation is refused and re-asked.

Changed: `src/shared/modules/replays.ts` (SidecarIssue/SidecarState/SidecarSaveResult,
`confirmReplace` on the write payload), `src/main/modules/replays/sidecar-store.ts` (defensive read
wiring + confirm-replace guard), `src/main/modules/replays/index.ts` (passes `confirmReplace`
through), `src/main/modules/replays/sidecar-store.test.ts` (adapted to the new read/write result
shapes), `src/renderer/src/i18n/locales/en.json` (`replays.sidecar.issue.*`).
Added: `src/main/modules/replays/sidecar-read.ts` + `.test.ts`, `sidecar-readonly.test.ts`,
`sidecar-guard.test.ts`.

Commit message: `147: a broken sidecar is reported, never overwritten`

Verification (narrow gate): `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (112 files / 1654 tests), plus the wider replays-area sweep
`npx vitest run src/main/modules/replays src/shared/modules/replays.test.ts src/shared/demos
src/shared/replays` green (25 files / 271 tests) — no collateral breakage. No e2e/ui:flow for this
story (every AC is proven by unit tests; the profile's known `ui:flow` first-locator timeout never
applied here). AC → test, all passed: AC1/AC2/AC3 → `sidecar-read.test.ts` (invalid JSON, bad field
named + rest kept, unknown schemaVersion named) + `sidecar-readonly.test.ts`'s parameterised
no-write-proof cases; AC4 → `sidecar-readonly.test.ts`'s bytes/mtime-unchanged cases and its
structural test (only `index.ts` and test files import `sidecar-store`'s write path); AC5 →
`sidecar-guard.test.ts` (unconfirmed asks and names the replacement, stale fingerprint re-asks,
broken-after-read is guarded, valid/absent needs no confirmation — 146 regression covered); AC6 →
`sidecar-readonly.test.ts`'s partial-use cases (valid `name`/`map` survive an invalid `rating` /
newer `schemaVersion`).

Review: one default-tier cycle (stage 2/hard not triggered — `Review: → default`). Verdict
UNCLEAR on one point, resolved by decision (see below) rather than a code fix; one minor
non-blocking observation, left as-is. No weakened tests, no scope creep, IPC/i18n rules upheld.

Decisions:

- Sidecar state/values are **not** embedded in the scan/index snapshot (`DiscoveredDemo`,
  `demos.list`/`index.read`). The incremental scan caches a row keyed off the _demo_ file's own
  identity (size/mtime); a sidecar can change without the demo file changing, so baking
  `sidecarState` into that cache would go stale exactly when a sidecar is edited or saved — the
  case this story exists to get right. 146 already chose a separate per-id `sidecar.read`
  handshake over merging into the index for the same reason; this story keeps that shape and makes
  the handshake itself defensive (never silently drops a broken file, always returns partial
  values). [[150]]/[[155]] read a row's sidecar state through `sidecar.read(id)`, not through an
  inline index field — this satisfies the "data layer, not rendering" scope this story set for
  itself without introducing a staleness bug. Flagged by the reviewer against the story's literal
  "every list/detail entry" wording; resolved as above rather than force-fitting the cache.
- Left as-is (non-blocking, reviewer-noted): a BOM-prefixed but otherwise valid sidecar's "unchanged"
  fast path compares raw (BOM included) against a freshly serialized value (no BOM), so such a file
  is rewritten (BOM silently stripped) on its next save. Harmless — 146's optimisation only, no data
  loss, no AC impact.
- A sidecar that exists but can't be read at all (EACCES/EISDIR — a filesystem problem, not a
  content one) has no bytes to fingerprint, so it is refused outright
  (`replays.sidecar.error.existingInvalid`) rather than offered a confirm-replace path — there is
  nothing to confirm against.
- `SidecarStoreFs.readFile` now returns raw `Buffer` (was decoded `utf8` string) so the
  confirm-replace fingerprint hashes the exact on-disk bytes, not a lossy UTF-8 decode.

tiers: D 3 / hard 1 · review default · cycles 1 · agents 5

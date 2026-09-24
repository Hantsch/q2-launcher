---
id: 110
title: the browser's data lives in its own state key
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Everything the `servers` module ([[106]]) remembers between restarts — favourites, manually added
servers, connection history, master sources and scan settings — needs one place to live before any
of the stories that write into it ([[111]], [[112]], [[113]]) can exist. This story builds only
that place: a new top-level `state.json` key the module owns outright, with its own zod schema and
a parse that never lets a broken or foreign value take the app down.

This is pure plumbing. It adds no CRUD, no UI, no IPC handler beyond what is needed to prove the
key round-trips — the operations that actually populate it are [[111]] (sources), [[112]]
(favourites) and [[113]] (manual servers, history).

The concept fixes two things this story has to honour rather than decide: the shape is **global to
the launcher, not per installation** — GB-P1, "it is about finding people, not managing setups",
unlike everything the `config`/`downloads` modules scope to an installation — and it follows the
precedent the `home` module already set for a module-owned key: a new top-level field in
`LauncherStateDocument` (`src/main/services/state.ts`), no `STATE_SCHEMA_VERSION` bump, no
migration entry, because the key is purely additive — a `state.json` written before this story
simply lacks it and loads as a safe default. `homeLayout` (story 086 D1) is exactly that
precedent: `parseHomeLayout` (`src/main/lib/schemas.ts`) falls back to `DEFAULT_HOME_LAYOUT` when
the stored value does not even parse as the right envelope, and drops a malformed row on its own
rather than discarding the whole layout. This story's schema and parse function follow the same
two-level defensiveness — envelope-level fallback to a safe empty default, row-level drop for
collection entries — for the same reason: a hand-edited or foreign `state.json` must never crash
the app, per `LauncherStateDocument`'s standing rule (`configProfiles`, `downloadFailures`, etc. all
already behave this way).

## Acceptance Criteria

- [ ] **AC1** — A new top-level `state.json` key exists, owned by the `servers` module, holding
      favourites, manual servers, history, sources and scan settings — no existing key
      (`LauncherSettings` or any other module's key) is extended or repurposed for this data (GB-P2).
- [ ] **AC2** — The key's shape has a zod schema in the shared layer (`src/shared/modules/servers.ts`,
      alongside [[106]]'s contract file), the same "one file per module describes what crosses the
      IPC boundary" convention `home.ts`/`downloads.ts` already follow.
- [ ] **AC3** — A parse function in `src/main/lib/schemas.ts` reads the raw stored value
      defensively: a value that does not parse as the key's envelope at all falls back to a named,
      documented safe empty default (mirroring `parseHomeLayout`'s fallback to `DEFAULT_HOME_LAYOUT`
      when the envelope itself fails); a malformed entry inside an otherwise-valid collection
      (e.g. one bad favourite, one bad source) is dropped on its own rather than discarding the
      whole key (mirroring `parseConfigProfiles`'/`parseHomeLayout`'s row-level drop).
- [ ] **AC4** — `StateStore` (`src/main/services/state.ts`) exposes a getter and a setter for the
      new key, wired through `JsonStore` the same way `homeLayout()`/`setHomeLayout()` are, and the
      key is included in `defaults()` with its safe empty default.
- [ ] **AC5** — Loading a `state.json` that lacks the key entirely (a file written before this
      story) does not crash the app and produces the same safe empty default as a freshly parsed
      missing value — no `STATE_SCHEMA_VERSION` bump and no migration entry is added for this key.
- [ ] **AC6** — Nothing in the schema, the parse function or `StateStore`'s access to this key
      accepts or stores an installation id, confirming the shape is global per GB-P1 — there is no
      per-installation scoping anywhere in it, unlike `configPlayedMods`/`configSwitchBinds`.
- [ ] **AC7** — A unit test (mirroring `state.test.ts`'s existing coverage for other keys) proves
      AC3 and AC5: a corrupt/foreign value for this key degrades to the safe default without
      throwing, and a single malformed row inside a populated collection is dropped without
      discarding its siblings.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 110`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 110`. -->

## Model Hints

<!-- Filled by `/refine 110`. -->

## Acceptance Tests

<!-- Filled by `/refine 110`. -->

## Done

<!-- Filled by `/build 110`. -->

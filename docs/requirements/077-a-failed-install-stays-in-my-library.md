---
id: 077
title: A failed install stays in my library and shows its last error
status: draft
created: 2026-09-08
---

## Requirement

On 2026-09-08 a real bootstrap run failed ([[075]], [[076]]). Afterwards the library was
**empty**: name, target folder and engine the user had picked in the wizard were gone, and the
only way forward was to walk the whole wizard again from the empty state
("NO QUAKE II INSTALLATIONS YET"). That is the wrong outcome — the user made decisions, the
launcher threw them away because a download failed.

The mechanism is deliberate today. The bootstrap job registers the installation early
([job.ts:440](../../src/main/modules/downloads/bootstrap/job.ts#L440)) and its `cleanUp()`
un-registers it again on failure and on cancel
([job.ts:552](../../src/main/modules/downloads/bootstrap/job.ts#L552)), with the reason stated in
the code: "no observer can ever see a `failed` job next to a still-registered half-built
installation" ([job.ts:577](../../src/main/modules/downloads/bootstrap/job.ts#L577)). The
invariant it protects is real — a half-built folder must never look playable — but the price is
too high: the launcher's own memory of what the user asked for is the first thing it deletes.

So: an installation the user created survives a failed download. It stays in the library, it says
what it is (not playable) and **why** (the download failed, with the failure's own error), and the
retry starts from it instead of from an empty library. A failure becomes a state of an
installation, not the deletion of one.

This also closes a second gap the same run exposed: the failure is currently only findable in the
Downloads tab. The library — the screen the user actually lands on — showed nothing at all.

## Acceptance Criteria

- [ ] **AC1** — A bootstrap job that fails leaves its installation registered. After an app
      restart it is still in the library with the name, root path and engine the user chose in the
      wizard.
- [ ] **AC2** — A cancelled job keeps [[074]]'s behaviour of the user's explicit "never mind" —
      whichever way this resolves (see Open Questions), cancel and failure are distinguishable and
      the choice is stated in the story, not left to the reader of the diff.
- [ ] **AC3** — The surviving installation carries its last failure: the downloads error key, when
      it happened and which job it was — persisted with the installation, machine-readable, no
      prose across IPC.
- [ ] **AC4** — The last failure is cleared as soon as that installation reaches a playable state
      (a later download succeeds, or the user points it at real game files) — a stale red mark on a
      working installation is worse than none.
- [ ] **AC5** — The library card and the rail tile show the failed state distinguishably from a
      merely `invalid` folder, with a non-colour indicator as well as the tone
      (`/design-tokens`), and the card names the failure using its existing i18n key.
- [ ] **AC6** — Launching a failed installation stays impossible: `isPlayable` still gates the
      Play action, and nothing in this story makes a half-built folder look ready.
- [ ] **AC7** — Retrying works from the surviving installation and does **not** trip
      `installations.error.duplicate` ([installations.ts:94](../../src/main/services/installations.ts#L94)) —
      the wizard pointed at the same folder must adopt the existing failed installation instead of
      failing to create a second one.
- [ ] **AC8** — A `state.json` written before this story loads unchanged, and an installation
      without the new field renders exactly as today.

## Open Questions

- **Q1 — Do the half-built *files* stay too?** `cleanUp()` does two things: it deletes the copied
  files (`removeAssembled`, plus the target dir when the job created it) and it un-registers the
  installation. This story only demands the second one stops. Keeping the registration while
  deleting the files leaves an honest `missing`/`invalid` installation pointing at an empty folder
  — cheap, no disk left behind, and a retry re-downloads from scratch. Keeping the files would
  make a retry resumable but risks exactly the "looks playable, isn't" state the current code
  guards against. Recommendation: delete the files, keep the registration.
- **Q2 — Cancel (AC2).** A user who cancels mid-download arguably wants no trace. Two candidates:
  cancel keeps today's full removal (registration included), or cancel also keeps the installation
  and simply carries no failure. Recommendation: cancel keeps today's behaviour — it is the one
  case where the user did say "drop it".

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

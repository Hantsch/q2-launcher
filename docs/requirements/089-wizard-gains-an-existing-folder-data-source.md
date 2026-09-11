---
id: 089
title: The wizard gains an existing-folder data source
status: draft
created: 2026-09-11
---

## Requirement

The third and last data source the wizard needs, per
[concepts/install-module.md §8](../concepts/install-module.md) step 2 and the "point at a folder
that already has data" half of INST-W2: a user who already has Quake II data somewhere the store
detection ([[088]]) does not recognise — a manual copy, an old install, a USB stick — points the
wizard at that folder instead of downloading or picking a detected store installation. The wizard
copies the retail (or demo) paks it finds there into the new installation exactly as [[088]] does
for a detected store installation; the engine is still fetched from the manifest and verified
exactly as [[074]] already does.

## Acceptance Criteria

- [ ] **AC1** — The wizard's game-data step always offers "point at an existing folder", regardless
      of whether any store installation was detected.
- [ ] **AC2** — Choosing this option lets the user browse to a folder; the wizard then reports what
      it found there (retail data, demo-only data, or nothing usable) before the user can proceed.
- [ ] **AC3** — A folder containing usable retail `pak0.pak`/`pak1.pak` proceeds exactly like
      [[088]]'s detected-store path: those files are copied (never linked) into the new
      installation, and the result carries no Demo marker.
- [ ] **AC4** — A folder containing only demo-equivalent data (no valid retail paks) proceeds as a
      demo installation, carrying the same Demo marker [[074]] introduced for the free-download
      path.
- [ ] **AC5** — A folder containing nothing usable is rejected with a reason before the job starts,
      not partway through.
- [ ] **AC6** — Before the job starts, the confirm step names the chosen folder as the data source,
      what will still be downloaded (the engine) and its size, and the target path.
- [ ] **AC7** — This data source produces `baseq2` only — no `ctf`, `xatrix` or `rogue` directory
      is created even if the source folder has one.

## Open Questions

- What exactly qualifies a folder as "usable retail data" for AC2/AC3 — presence of correctly
  sized `pak0.pak`/`pak1.pak` at a fixed relative path (`baseq2/`), or something looser (any
  subfolder, any pak count)? [[088]]'s AC3 size check is the natural reference point; refine should
  decide whether the two stories share one detection routine.
- Should the browsed folder itself be the thing inspected (e.g. the user selects their old
  `baseq2` directly), or a game root that is expected to contain `baseq2` — this changes what the
  file-picker dialog asks the user to select.

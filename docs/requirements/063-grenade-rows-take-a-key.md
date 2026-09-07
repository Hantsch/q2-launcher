---
id: 063
title: Hand grenades and Grenade Launcher can be bound to a key
status: draft
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

- [ ] **AC1** — A key can be assigned to the *Hand grenades* row in Controls > Weapons, the same way
      as for any other weapon row.
- [ ] **AC2** — A key can be assigned to the *Grenade Launcher* row.
- [ ] **AC3** — Both binds survive a save/reload round trip and appear in the written cfg as the
      correct commands (`use grenades`, `use grenade launcher`), correctly quoted.
- [ ] **AC4** — Assigning one of the two does not disturb the other, and neither collides with the
      `drop grenades` rows in Drops.
- [ ] **AC5** — A regression test fails on the un-fixed code and names the actual cause.

## Open Questions

- [ ] Screenshot of the symptom: is there no bind slot on those rows, or does the slot refuse the
      capture / show a blocking banner? (Report referenced an image that did not reach the repo.)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

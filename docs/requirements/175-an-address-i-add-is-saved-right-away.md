---
id: 175
title: an address I add is saved right away
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

When I add a server to my address book from the server browser ([[127]]), the launcher writes the
address into the profile's `adrN` cvar but leaves the profile *unsaved*: the Config view shows
"Unsaved changes" and the `.cfg` on disk does not contain the address yet. I only find out when I
open Config — and I have to know to press Save there, otherwise the game's own address book stays
empty. The dialog said "added"; the game says otherwise. That is a trap, not a feature.

Confirming "Add" in the dialog must be the whole action: after it, the address is in the profile's
`.cfg` on disk and the game's address book shows it, without a detour through the Config view.

This changes the choice recorded in [[127]] (AC4: the write leaves the profile in the config
module's normal dirty state). That was right for a *cvar edit*, where the user is in the Config view
and sees the Save button; it is wrong for an *action* triggered from another view, where the user
has no reason to look there.

## Acceptance Criteria

- [ ] **AC1** — After confirming "Add to address book", the chosen `adrN` value is in the profile's
      `.cfg` on disk (the Raw file tab shows it as `ON DISK`, with no "not in this file yet" notice for
      it).
- [ ] **AC2** — The profile does not show "Unsaved changes" because of the address write, and the
      Config view's unsaved counter does not include it.
- [ ] **AC3** — If the profile already had *other* unsaved changes, only the address is written to
      disk; the other pending edits are neither saved nor lost and the profile still shows them as
      unsaved (Q1, decided).
- [ ] **AC4** — If saving fails (e.g. the file is not writable), the dialog stays open and shows the
      error as text; the address is not reported as added and no half-written state remains.
- [ ] **AC5** — The success toast says the address is saved to the profile (i18n key, `en` locale),
      not merely "written".
- [ ] **AC6** — Story [[127]]'s ACs that this supersedes (AC4) are amended in place with a pointer
      to this story, so the two documents do not contradict each other.

## Open Questions

- **Q1 — Profile already dirty (decided 2026-09-29):** only the address is saved; everything else
  pending stays pending and is never saved automatically.
- **Q2 — Which layer saves:** does the dialog call an existing config save path after `setCvars`, or
  does the config module get one "set cvars and save" operation? Prefer the latter (one round trip,
  no window where the profile is dirty) — check `modules/config/client.ts` and the main-side
  `profiles.ts` before deciding.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

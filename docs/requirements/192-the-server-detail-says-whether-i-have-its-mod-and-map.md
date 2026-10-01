---
id: 192
title: the server detail says whether I have its mod and map
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player looking at a server in the browser, I can see at once whether my active installation
has the server's mod and its current map. If the mod is missing and the launcher's catalog has
it, I can install it right there instead of hunting for it. This redeems GB-D5, which was cut from
story 124 and is owned by the Mods module ([game-browser.md](../concepts/game-browser.md) GB-D5),
extended with an install offer.

Concept: [mods.md](../concepts/mods.md) §11; requirements MOD-15 to MOD-17.

## Acceptance Criteria

- [ ] **AC1** — The server detail shows a visible statement of whether the server's mod exists in
      the active installation (*mod installed* / *mod missing*). A server on the base game shows
      no mod statement.
- [ ] **AC2** — The server detail shows a visible statement of whether the server's current map
      exists locally (*map available* / *map missing — the server will send it*).
- [ ] **AC3** — With the mod missing and a catalog entry of the same gamedir name (matched
      case-insensitively), the detail offers *Install*. Clicking it starts story 190's install
      into the active installation.
- [ ] **AC4** — With the mod missing and no catalog entry, no Install button appears, and the
      statement stays.
- [ ] **AC5** — When the install finishes, the statement changes to *mod installed* without
      reopening the detail.
- [ ] **AC6** — A gamedir string from a server that is not a safe single path token is shown as
      text but never used to build a path or start an install.

## Open Questions

- **Q1** (concept §14 item 3) — Is "the map exists locally" a check for a loose `maps/<map>.bsp`
  only (in the mod's gamedir and `baseq2`), or does it also look inside `.pak`/`.pkz` files?
- **Q2** (concept §14 item 5) — How does the servers module ask the mods module for catalog and
  installed status and start an install, without editing the shell? Options: a shared pure helper
  plus the renderer calling the mods channels, or a main-side service on `AppContext`.
- **Q3** — Is the statement shown in the detail only, or also as a marker in the server list rows?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

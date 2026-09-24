---
id: 106
title: a servers module exists with its own nav entry
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the launcher and sees a "Servers" entry in the primary navigation, at the same level
as Library and Config — a dedicated place to find out where something is going on, distinct from
managing an installation. Today that place does not exist; the game browser concept
(`docs/concepts/game-browser.md`) describes everything it will eventually do, but nothing is
registered with the app yet.

This story does none of that content. It is the foundation the other three stories in this sprint,
and every later game-browser sprint, are built on: a module that exists, is reachable, has its own
IPC namespace and settings slot, and declares no platform delta — so [[107]], [[108]] and [[109]]
have a home to land their code in, and later sprints have a route and a settings section to fill
rather than create.

The concept left the module's final id and label open (its own open point #8: the document uses
`servers` throughout but the home concept once called the planned feature "Gamebrowser"). This
story settles it: the module id is `servers`, following [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module)'s
existing lowercase-noun convention (`library`, `config`, `downloads`, `mods`, `assets`), and its
nav label is "Servers" — the plain, activity-neutral name a user would look for, not the
implementation-flavoured "Gamebrowser". This is a decision, not an open question.

The concept also states that this milestone turns platform parity into a standing CLAUDE.md rule
(§15). That rule is already present in the live `CLAUDE.md` under "Key rules" ("Platform parity is
explicit."), landed by an earlier story — so this story adds no new rule text. It only has to show
that the `servers` module honours it: the module declares no platform-specific capability or
behaviour, consistent with `node:dgram` and `fetch` both being platform-neutral (concept §15, GB-T2).

## Acceptance Criteria

- [ ] **AC1** — A `servers` module is registered per the 5-step checklist in
      [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module): a shared contract file
      under `src/shared/modules/`, a `ModuleId` entry, a `MODULE_MANIFESTS` row, a main half, and a
      renderer half — with no edit to `AppShell.tsx` or any other shell file.
- [ ] **AC2** — The manifest's `nav` is `{ section: 'primary', order: … }`, placing "Servers" in the
      primary nav alongside Library and Config; clicking it routes to the module's (empty/placeholder)
      view.
- [ ] **AC3** — The manifest declares the `network` and `game-lifecycle` capabilities and no others.
- [ ] **AC4** — The module's `ipcNamespace` (`module:servers`) exists and is asserted as owned by this
      module the same way every other module's namespace is (a handler registered outside it is
      rejected).
- [ ] **AC5** — The renderer module entry contributes a `settingsSection` (title + order + `Section`
      component) that renders in the Settings view, even though it currently shows no controls — the
      slot later sprints populate.
- [ ] **AC6** — `CLAUDE.md`'s "Key rules" carries the platform-parity rule (verified present, not
      re-added); the `servers` module's manifest and code declare no platform-specific capability or
      branch, matching GB-T2.
- [ ] **AC7** — The module's contract file (`src/shared/modules/servers.ts`) exists with at least one
      handler name declared, and every `module:invoke` handler for `servers` is backed by a
      module-local zod schema before it is implemented — the same contract-first discipline
      `src/shared/ipc.ts` enforces for shell-level channels, restated here as GB-A2 and binding for
      every story that adds a `servers` handler in this and later sprints.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 106`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 106`. -->

## Model Hints

<!-- Filled by `/refine 106`. -->

## Acceptance Tests

<!-- Filled by `/refine 106`. -->

## Done

<!-- Filled by `/build 106`. -->

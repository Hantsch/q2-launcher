---
id: 318
title: Integrated mode is at parity on Linux, covered by flows and documented
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a Linux user I want to use the integrated player and the export as on Windows — or read,
visibly, why something does not work — so that Linux users are not second-class.

Context:

- CLAUDE.md key rule "Platform parity is explicit": a feature that cannot work on a platform stays
  visible, disabled, with its reason as visible text ("Not available on Linux: …") as an i18n key.
- [concept §10.4](../concepts/integrated-demo-player.md): on Linux
  `hardwareAcceleration: 'prefer-software'`
  ([electron/electron#55456](https://github.com/electron/electron/issues/55456)), AAC through the
  polyfill (tier 2).
- Test lanes per CLAUDE.md: Linux jobs are advisory (`linux-verify.yml`, the `ui-flows.yml` Linux
  job), run locally with act (`npm run ci:local:verify`, `npm run ci:local:flows`). This story
  does not change the lane policy (the maintainer decides that, `/test-gates`).
- Docs: `docs/systems/replays-module.md` (map, handlers, external inputs, limitations),
  `CHANGELOG.md` (`## Unreleased`), `docs/ARCHITECTURE.md` only if an architecture rule changes
  (the CSP exception from [[288]]).
- Flow register: `scripts/flows/areas.json` (for `--affected`).
- Constraints: Linux-specific probe switches only in `encoder-selection.ts` ([[306]]); flows use
  the fake engine (no game data, no GPU dependency).
- Not in scope: Wayland/X11 placement (integrated mode needs none; engine mode keeps its limits);
  macOS.
- Depends on: [[303]], [[306]].

Expected manual residue: on a real Linux desktop (X11 and Wayland) with an Intel / VA-API GPU,
play a demo integrated and export it — no GPU process crash, sound in the MP4. The maintainer
reads the CHANGELOG lines.

## Acceptance Criteria

- [ ] **AC1** — On a Linux host (act container with Xvfb) the integrated-mode flows with the fake
      engine — toggle, playback, timeline, export, disabled controls — are green
      (`npm run ci:local:flows`, advisory); any exception is in `scripts/flows/quarantine.json`
      with a reason and a story reference.
- [ ] **AC2** — On Linux the export's video probe uses `hardwareAcceleration: 'prefer-software'`
      (unit test of the selection with `platform: 'linux'`).
- [ ] **AC3** — On Linux the export's audio probe uses tier 2 (same unit test,
      `npx vitest run src/renderer/src/modules/replays/export/encoder-selection.test.ts`).
- [ ] **AC4** — An export option missing on a platform (e.g. no H.264, ffmpeg flag off) is
      visibly disabled in the dialog with the text "Not available on Linux: …" (key under
      `replays.export.unavailable.*`); a flow checks the visible text, not only the `disabled`
      attribute.
- [ ] **AC5** — The new flows are assigned to the `replays` area in `scripts/flows/areas.json`, so
      `npm run ui:flows -- --affected src/renderer/src/modules/replays/` selects them, and they
      are green.
- [ ] **AC6** — `docs/systems/replays-module.md` describes mode switching, the `DemoPlayer` API,
      the engine host, the data session and protocol, the export sink and the export pipeline.
- [ ] **AC7** — `docs/systems/replays-module.md` lists the new handlers and events.
- [ ] **AC8** — `docs/systems/replays-module.md` names the limits: manifest size cap, MVD2 status,
      Linux encoder tiers; `npx vitest run src/main/modules/systems-docs.test.ts` is green.
- [ ] **AC9** — `## Unreleased` in `CHANGELOG.md` has exactly one line for integrated mode and one
      for the MP4 export (≤ ~15 words each, no internals), with every refinement of the sprints
      folded in.
- [ ] **AC10** — `docs/ROADMAP.md` replaces the open row "Demos in a browser (WASM) engine".
- [ ] **AC11** — `npm run format:check && npm run typecheck && npm run lint && npm test` is green.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

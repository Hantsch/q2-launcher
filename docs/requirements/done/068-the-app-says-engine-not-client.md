---
id: 068
title: the app says engine, not client
status: draft
created: 2026-09-07
---

## Requirement

The launcher calls the same thing two different names. Internally everything is an *engine*
(`EngineKind`, `engineKind`, the engine badge from story 065), but several user-visible labels
still say "Client" — the Create-installation dialog's dropdown, the library's detail row, the
detection error messages. As a user I read one word for one concept: **engine**. "Client" as a
term for the executable stays where it genuinely means the binary ("Client executable" → engine
executable), but it never names the engine itself.

On top of that, only two engines are actually supported for now: **R1Q2** and **Q2PRO**. Everything
else the detector knows (yquake2, KMQuake II, vkQuake2, Q2RTX, remaster, vanilla) should keep being
*recognised* — an existing installation must not lose its label — but I should not be able to pick
an unsupported engine when I create a new installation, and an installation running one should say
so instead of pretending it is fully supported.

## Acceptance Criteria

- [ ] **AC1** — No user-visible string in `src/renderer/src/i18n/locales/en.json` uses "client"/
      "Client" as a name for the engine. Where the word means the executable it reads as engine
      executable instead.
- [ ] **AC2** — The Create-installation dialog's engine dropdown offers exactly R1Q2 and Q2PRO;
      the label above it reads "Engine".
- [ ] **AC3** — Detection still classifies all engines in `ENGINE_DEFINITIONS`: an installation on
      an unsupported engine keeps its own badge label and is not degraded to `unknown`.
- [ ] **AC4** — An installation whose engine is outside the supported set is marked as unsupported
      where its engine is shown, in text (not by colour alone).
- [ ] **AC5** — Which engines are supported is data on `EngineDefinition`, not a hard-coded list in
      the dialog — adding a third supported engine is a one-line change in `src/shared/types/engine.ts`.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

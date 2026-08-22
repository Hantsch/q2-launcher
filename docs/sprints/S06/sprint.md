---
sprint: S06
status: in-progress # planned | in-progress | done
branch: sprint/S06
milestone: Polish + hardening — clear the post-S05 backlog (docs/ROADMAP.md, "Follow-ups worth doing")
---

# Sprint S06 — Say what it does, and mean what it claims

## Goal

The launcher's chrome and its planned-module screens speak to users instead of to the people
building it: a proper header, "Downloads" where a status control belongs, and plain-language
copy where Mods and Assets used to list architecture capabilities. Underneath, three guardrails
that currently only look like guardrails become real: the CSP applies in the shipped build, IPC
payload validation cannot be forgotten, and `ui:verify`'s green report is a fact.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 031 — Rename the Install module to Downloads and move it next to Settings
- [x] 030 — Titlebar and wordmark scale up
- [x] 033 — Planned-module screens explain the feature, not the engineering
- [x] 029 — Drop-row team message as checkbox + inline row (mirrors "With ammo")
- [x] 035 — The Content-Security-Policy actually applies in a production build
- [x] 036 — Payload validation cannot be forgotten — handle() requires a schema
- [ ] 037 — ui:verify covers every surface and its report is green (blocked: AC5/story 027 live focus-steal check needs a human at the real desktop; everything else complete and green)

## Notes

Seven stories is above the 3–6 guideline, deliberately: four of them are small, and the sprint is
two coherent clusters with an obvious split point after 029 if it turns out to be too much for one
acceptance pass (031/030/033/029 = what the user sees, 035/036/037 = what the user has to trust).

Build order is dependency-driven:

- **031 before 030** — 031 is the invasive one (`ModuleId` union, route, IPC namespace, i18n keys,
  and moving the nav entry out of the content nav to the right-hand utility group). 030 then scales
  up whatever TitleBar 031 leaves behind; the reverse order would mean doing the taller-bar layout
  twice.
- **033 and 029** are self-contained and touch nothing the others need.
- **037 last** — it is the story that has to see the *finished* UI: it records a full harness run,
  so every visible change from 029–031 and any CSP fallout from 035 is already in the app when its
  screenshots and axe report are taken.

Explicitly out of scope:

- **032** (Downloads running-count badge) stays filed and unsprinted — it is blocked on the
  downloads module actually producing jobs, which does not exist. 031 only renames and relocates;
  it does not implement downloads.
- The **downloads module itself**. It has no concept document yet (`docs/concepts/` is empty), and
  it is the next real milestone, not a polish item — `/concept` first.
- The **config-module gaps** from S02/S03/S05 (`setPlayedMods`/`setSwitchBind` without a sync pass,
  `removeShadowedBind` trusting the renderer's loser claim, the nine findings from story 010's
  review). Still open, still unfiled as stories, deliberately not mixed into this sprint.

Story **027** is not in the build list because there is nothing left to build in it — only its one
experiential check is open. It is an acceptance criterion of 037 and closes with 037's test plan.

Three of the four new/hardening stories carry real `## Open Questions` (035: which scheme, and
whether the harness even drives a production build; 036: whether the runtime schema belongs in the
shared contract; 037: whether the exit gate should fail on `moderate`, and what happens to
`page-has-heading-one`). `/sprint`'s clarification round has real work to do here. One question
worth resolving once rather than twice: 035 and 037 both depend on whether `ui:verify` drives a
dev-mode or production-mode build.

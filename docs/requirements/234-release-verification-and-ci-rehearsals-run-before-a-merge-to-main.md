---
id: 234
title: release verification and CI rehearsals run before a merge to main
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

Several checks that guard a release were never observed in S32. `npm run verify:release` was not run
(the Docker daemon was down and the run exceeds the 10-minute call ceiling), and nothing in the
sprint ran it, although story [[226]] changed the dependencies it exercises (Electron 43.7.7).
Story [[223]] added the `ui-flows` and `windows-verify` workflows, but the `act` rehearsals
`npm run ci:local` and `npm run ci:local:flows` were not observed either (over the ceiling), so the
Linux-only red flows were never determined and the real GitHub-runner shard timings and the
`windows-latest` run are unmeasured.

The maintainer wants one named, repeatable way to run these long checks outside an agent's call
ceiling, with their result recorded, before a sprint branch goes towards `main`.

## Acceptance Criteria

- [ ] **AC1** — A documented command or script runs `verify:release`, `ci:local` and `ci:local:flows`
      detached from the agent call ceiling and writes a pass/fail record with timings.
- [ ] **AC2** — The Linux-only red flows `ci:local:flows` finds are in `scripts/flows/quarantine.json`
      with a reason, or fixed.
- [ ] **AC3** — The recorded per-shard wall time stays under the `timeout-minutes: 20` of the
      `ui-flows` workflow with margin, and the `windows-verify` job has run green once on GitHub.
- [ ] **AC4** — The sprint workflow notes (`docs/sprints/README.md`) say when this run is expected
      (before a merge to `main`, not per sprint).

## Open Questions

<!-- AC3 needs a pull request into `main` or a workflow dispatch on GitHub, which agents may not
trigger (org policy); that part stays the user's step and becomes manual residue. Is the Docker
daemon expected to be available on this machine, or does the run belong on a different host? -->

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

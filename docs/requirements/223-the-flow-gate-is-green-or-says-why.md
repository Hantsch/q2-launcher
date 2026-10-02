---
id: 223
title: the flow gate is green or says why
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the end-of-sprint flow gate to be binary — green, or red for a reason
that names a new regression — so that a sprint review no longer spends an hour attributing
"pre-existing" failures, and I want the bulk of the e2e coverage to run in CI instead of only on
one machine.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F21, F59, F72; the four
red flows are a roadmap follow-up three times over): `scripts/flows-all.mjs` is a 50-line loop
with no expected-failure list, retry or per-flow timeout; `replays-extra-folders`,
`servers-filter-search`, `servers-master-sources` and `servers-sort-order` have been red and
"pre-existing" in every review S27–S31 (the word appears 60 times across reviews); S31 ran
132/136 in 49 minutes plus ~10 minutes of attribution. Root causes are already written down
(a stale three-default-sources expectation; `[data-testid^="servers-row-"]` also matching the
`servers-row-copy-*` buttons). CI runs 4 of 136 flows; 29 `waitForTimeout` sleeps;
`replays-mod-warning` flakes 1–2 of ~6 runs. Every gate bisect S27–S31 had the same shape: a
flow asserting another story's incidental detail (fixture ordinal, Tab count, literal cvar
value, stage pixel geometry). All UI jobs run on Linux although ~80 % of users are on Windows;
the checkout/setup-node/npm ci/"Install Electron binary" block is repeated in four workflows.

## Acceptance Criteria

- [ ] **AC1** — The four chronically red flows pass on `dev` (sort-order selector tightened or
      copy buttons re-prefixed; master-sources expectation updated; extra-folders stabilised;
      filter-search diagnosed and fixed); the three roadmap follow-ups about them are removed.
- [ ] **AC2** — `scripts/flows/quarantine.json` (`{ flow, reason, story, since }`) is consumed by
      `flows-all.mjs`: quarantined flows report "expected fail" or "unexpected pass"; the run
      exits 0 only when every non-quarantined flow is green; it fails when a quarantined flow
      passes twice in a row or an entry is older than three sprints. A test in
      `scripts/*.test.mjs` covers the three outcomes.
- [ ] **AC3** — `flows-all.mjs` supports `--shard=i/n` and a per-flow timeout; a `ui-flows` CI
      job (ubuntu, xvfb) runs all non-quarantined flows sharded to stay under ~15 minutes, on PRs
      into `main` and nightly.
- [ ] **AC4** — docs/UI-VERIFICATION.md has a "What a flow may assert" section: user-visible
      outcomes and `data-testid`s; never literal cvar values, Tab counts, fixture ordinals or
      pixel geometry; one deterministic fixture builder. `/sprint`'s review step references it.
- [ ] **AC5** — A composite action `.github/actions/setup-node-electron/action.yml` replaces
      the duplicated setup blocks in all four workflows; the Electron binary is cached keyed on
      its version.
- [ ] **AC6** — A `windows-verify` job runs build + `ui:verify` + three flows on
      `windows-latest` with screenshot artifacts, at least nightly.

## Open Questions

- [ ] **Q1** — Shard count and runner budget: how many parallel Linux runners are acceptable for
      the PR gate vs nightly?
- [ ] **Q2** — Should `replays-mod-warning` go into quarantine until its flake is fixed, or be
      fixed in this story?

## Plan

<!-- Filled by /refine 223. -->

## Deliverables

<!-- Filled by /refine 223. -->

## Model Hints

<!-- Filled by /refine 223. -->

## Acceptance Tests

<!-- Filled by /refine 223. -->

## Done

<!-- Filled by /build 223. -->

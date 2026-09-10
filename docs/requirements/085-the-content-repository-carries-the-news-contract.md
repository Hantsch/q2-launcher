---
id: 085
title: The content repository carries the news contract
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

The feed only exists if someone can write one. The public `Hantsch/q2_community_content`
repository must therefore carry the contract in a form a contributor can follow without reading
launcher source: the directory layout, the `index.json` fields, every template with its exact
field set, and the button rules. It also gets a first real set of entries — one per template — so
the launcher's own hero has something to show and the contract is proven by an example rather
than only described.

The repository's later content types are fixed now at almost no cost: `packs/`, `mods/` and
`config_templates/` exist as directories from day one, and nothing reads them in v1.

Work happens in the existing local checkout `C:\development\Hantsch\q2_community_content`. The
files are written, not published: no commit, no push, no release — publishing stays my decision.

## Acceptance Criteria

- [ ] **AC1** — The checkout contains `news/` with `index.json`, an `img/` directory, and the
      empty-but-present `packs/`, `mods/` and `config_templates/` directories.
- [ ] **AC2** — `news/index.json` carries `schemaVersion` and entries with `id`, `file`, `order`
      and optional `visibleFrom`/`visibleUntil`, in exactly the shape the launcher validates.
- [ ] **AC3** — `news/` contains at least one valid entry per template (`split`, `banner`,
      `text`), including the image an image template references.
- [ ] **AC4** — The repository's `README.md` documents the directory layout, every `index.json`
      field, every template with its fields, the button rules (max 3, external links only, host
      allowlist) and how visibility and order work.
- [ ] **AC5** — The README states that a contributor supplies content only — no CSS, HTML,
      colours or layout values — and what happens to an entry that breaks a rule (dropped, with
      the rest of the feed still shown).
- [ ] **AC6** — The launcher validates this exact `index.json` and these exact entries without a
      single warning, proven by a test that reads the checked-in fixture copy of them.
- [ ] **AC7** — Nothing in the launcher's test suite or `ui:verify` fetches this repository over
      the network; the fixture copy is what the tests use.
- [ ] **AC8** — No commit, branch, push or release is created in the content repository by this
      story.

## Open Questions

- Do the reserved directories get a placeholder README each stating "reserved, not read yet", or
  do they stay empty?
- `config_templates/` is the likeliest next content type and may want the same `index.json`
  shape. Is that shape sketched in the README now, or deliberately left open? (Concept open
  point 13.)

## Plan

_Filled by `/refine 085`._

## Deliverables

_Filled by `/refine 085`._

## Model Hints

_Filled by `/refine 085`._

## Acceptance Tests

_Filled by `/refine 085`._

## Done

_Filled by `/build 085`._

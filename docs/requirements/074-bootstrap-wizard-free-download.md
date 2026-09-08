---
id: 074
title: The Library turns nothing into a playable Q2PRO demo installation
status: draft
created: 2026-09-08
---

## Requirement

This is the sprint's playable moment: a user with nothing installed opens a wizard from the
Library, picks Q2PRO, and ends up with a working installation running the freely-downloadable
demo data — no forum thread, no manual file placement. This story wires the manifest ([[070]]),
the verified-download pipeline ([[071]]), and the Downloads tab ([[073]]) into the bootstrap
wizard described in [concepts/install-module.md §8](../concepts/install-module.md), scoped to
the **free-download data source only** — copying retail paks from a detected store installation,
pointing at an existing folder, and the demo-to-retail upgrade action are explicitly out of this
sprint (see sprint.md).

## Acceptance Criteria

- [ ] **AC1** — A wizard, reachable from the Library next to the existing "create installation"
      entry, offers Q2PRO as the only engine (the only one this sprint ships a manifest entry
      and a pinned version for).
- [ ] **AC2** — The wizard lets the user pick a target folder; a target under `Program Files`
      shows a warning naming the write-access consequence with the existing `set-write-dir`
      remedy offered, and the user may acknowledge and continue.
- [ ] **AC3** — A non-empty target folder shows a warning listing what is already in there,
      with a "continue anyway" option.
- [ ] **AC4** — Before the job starts, the wizard states what will be downloaded and its total
      size, and the target path.
- [ ] **AC5** — Running the wizard downloads the Q2PRO engine and the free demo data
      (`q2-314-demo-x86.exe` and the 3.20 point release), verifies both, extracts them with
      7-Zip, and assembles a `baseq2` installation.
- [ ] **AC6** — The resulting installation is registered with a status computed by
      `inspectInstallation` — never a hand-set "success" status — and the Play button lights up
      the moment that verdict stops being `invalid`/`missing`, even while the job is still
      copying auxiliary files.
- [ ] **AC7** — Because its data is the free demo, the installation carries a visible "Demo"
      marker on its tile, library card, and action bar (the upgrade-to-retail action itself is
      out of scope this sprint).
- [ ] **AC8** — The wizard produces only a `baseq2` directory — no `ctf`, `xatrix`, or `rogue`
      directory is created, even though the 3.20 package used also contains a `ctf` payload.

## Open Questions

- Naming and identity of a bootstrapped installation: what default name does it get, is any
  icon assigned automatically, and where does it land in the rail's sort order relative to
  manually-added installations? (concept open point 16)
- Does the bootstrap also copy `baseq2/video/` and `players/` from the demo/point-release
  archives, or only the paks strictly required for `inspectInstallation` to pass? (concept open
  point 17)
- Is a disk-space precheck in scope before the job starts, or is "the job fails partway with a
  readable reason" acceptable for this first sprint? (concept open point 15)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

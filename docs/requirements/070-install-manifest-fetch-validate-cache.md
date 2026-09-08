---
id: 070
title: The launcher reads a curated manifest instead of hardcoded download URLs
status: draft
created: 2026-09-08
---

## Requirement

Every engine build and free game-data package the launcher will ever offer to download comes
from one curated manifest in the public `Hantsch/q2_community_content` repository — the same
`raw.githubusercontent` transport the home screen already uses for `news/` (see
[concepts/home-screen.md](../concepts/home-screen.md)). No download URL is hardcoded in the
launcher: a dead mirror or a new engine version costs one commit to the content repo, never a
launcher release. This story delivers the manifest itself (real Q2PRO nightly + free
game-data entries, per [concepts/install-module.md §6-7](../concepts/install-module.md)) and the
main-process pipeline that fetches, validates, and caches it, so later stories (download,
wizard) have real data to work against.

## Acceptance Criteria

- [ ] **AC1** — The manifest is fetched by main over `raw.githubusercontent` on `main` of
      `Hantsch/q2_community_content`, from a new `engines/` and `gamedata/` layout next to the
      existing `news/`.
- [ ] **AC2** — Every package in the manifest carries `schemaVersion`, id, version, engine kind
      or role, primary URL, an ordered list of mirrors, size in bytes, and SHA256; the shape is
      validated with zod in main before any of it reaches the renderer.
- [ ] **AC3** — A package that fails validation is dropped with a log line; the rest of a
      structurally valid manifest stays usable.
- [ ] **AC4** — The last successfully validated manifest is cached in `userData`; when the
      network fetch fails, the cached copy is used and its age is exposed to callers.
- [ ] **AC5** — Per engine, the manifest names one **pinned** version, retrievable as the
      default for a new installation or an update check.
- [ ] **AC6** — The real manifest content ships in the content repository: the Q2PRO `nightly`
      build (pinned per the resolution of Open Question 1) and both free game-data packages
      (`q2-314-demo-x86.exe`, `q2-3.20-x86-full-ctf.exe`), each with a real SHA256 computed
      against the currently published asset.

## Open Questions

- Q2PRO's `nightly` release is a rolling tag — the same asset URL keeps being replaced with new
  content, so a SHA256 pinned today can start failing the moment upstream republishes. Do we (a)
  mirror the pinned asset into our own release under `Hantsch/q2_community_content` so the pin is
  truly immutable, or (b) pin URL+hash against upstream and let the pin break loudly (manifest
  validation fails, update/bootstrap jobs report a clear "upstream moved" reason) until someone
  re-pins it by commit? (concept open point 3)
- How is a `schemaVersion` higher than the launcher knows handled — ignore-with-note, or refuse
  the manifest outright? (concept open point 11)
- Does the content repository need a README documenting the manifest format for future
  maintainers, and is that in scope for this story or a fast-follow?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

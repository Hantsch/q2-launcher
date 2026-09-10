---
id: 084
title: Slide images come from the launcher's own cache
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

Two of the three slide templates carry an image, and a news front page without pictures is a
notice board. The images must still not weaken the app: the renderer never talks to a remote
origin, the production Content-Security-Policy stays exactly as it is, and a slide whose image is
missing or fails to download still renders — just without the picture.

So main fetches an entry's image, keeps it in its own cache and serves it over the privileged
`q2launcher://` scheme the launcher already uses. Once cached, the news looks the same offline as
online. The cache must not grow without a bound.

This is also the one place where a bitmap legitimately enters the UI: feed images are foreign
content, never a shipped asset. That deviation from the "no image assets" rule is recorded, not
bent quietly. See [concepts/home-screen.md](../concepts/home-screen.md) §9 and §10.

## Acceptance Criteria

- [ ] **AC1** — A slide image is downloaded by main, stored in userData and rendered from a
      `q2launcher://` URL; no renderer request goes to a remote origin.
- [ ] **AC2** — The production CSP is byte-for-byte unchanged by this story.
- [ ] **AC3** — A slide whose image is missing, fails to download or is not an image renders
      without it, and the surrounding template stays intact rather than collapsing.
- [ ] **AC4** — A cached image is shown offline, without a network attempt while offline.
- [ ] **AC5** — The image cache stays inside a stated budget: when it is exceeded, the least
      recently used images are removed, and an image belonging to a currently visible slide is
      never removed.
- [ ] **AC6** — `CLAUDE.md` carries a deviation row for feed images against the "no image assets
      in the UI" rule, naming this story and the reason.
- [ ] **AC7** — `ui:verify` covers a slide with an image and a slide whose image failed, both from
      the fixture and without network access, at zero axe violations.

## Open Questions

- What is the cache budget, and what happens when a cached image's source disappears upstream —
  keep serving the copy, or drop it? (Concept open point 5.)
- Is there a maximum accepted image size or dimension, and what happens to an image that exceeds
  it?

## Plan

_Filled by `/refine 084`._

## Deliverables

_Filled by `/refine 084`._

## Model Hints

_Filled by `/refine 084`._

## Acceptance Tests

_Filled by `/refine 084`._

## Done

_Filled by `/build 084`._

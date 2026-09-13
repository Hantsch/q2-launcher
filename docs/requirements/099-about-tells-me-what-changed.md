---
id: 099
title: About tells me what changed
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-13
---

## Requirement

Settings' About section
([SettingsView.tsx:139](../../src/renderer/src/views/SettingsView.tsx#L139)) today lists a version
number and the runtime versions underneath it — true, and useless for deciding whether to update.
A user who is being asked by [[098]] to restart their launcher wants to know what they get for it,
and a user who just updated wants to know what they got. Both are the same question asked from two
sides, and the answer is the release notes [[096]] publishes with every release.

So About becomes the place where the version stops being a bare number: what this version brought,
what a pending update would bring, and a way through to the full history for anyone who wants it.
The notes come from the release, not from a second hand-maintained text in the app — the changelog
is already the single source ([[096]] AC1).

## Acceptance Criteria

- [ ] **AC1** — About shows what changed in the currently running version, not only its number.
- [ ] **AC2** — When [[097]] has an update available, About shows that version's notes too, marked
      as not yet installed, next to the same update action [[098]] offers in the titlebar.
- [ ] **AC3** — About links out to the project and to the full changelog, opened in the system
      browser through the existing external-link path, never in an app window.
- [ ] **AC4** — About says when the launcher last checked for updates and lets the user check now,
      showing the outcome including a failure reason ([[097]] AC7).
- [ ] **AC5** — Notes that are unavailable (never fetched, offline, an older version that predates
      published releases) render as a readable empty state, never as a blank panel or a crash.
- [ ] **AC6** — The notes render as readable text — headings and list items from the changelog
      section — not as raw markdown source, and cannot inject markup into the renderer.

## Open Questions

- **Where do the notes for the _installed_ version come from?** Fetched from the release feed like
  [[097]] does (works offline only when cached), or bundled into the build from `CHANGELOG.md` at
  package time (always available, always exactly this version). Recommendation: bundle the installed
  version's section at build time, fetch only the pending one — AC1 then works offline, which is the
  common case.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

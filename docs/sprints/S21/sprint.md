---
sprint: S21
status: in-progress # planned | in-progress | done
branch: sprint/21
milestone: 7.1 — Release & updates (beta rollout)
---

# Sprint S21 — The launcher ships itself: release, changelog, updater

## Goal

The launcher can be handed to real beta users and keep them current: a deliberate release
produces a versioned, published Windows build whose notes come from the changelog; an installed
launcher finds out once a day that a newer one exists; and the user updates when they choose to,
from the titlebar or from About, seeing what they get for it.

## Stories (in build order)

- [x] 096 — A release ships from a changelog
- [x] 097 — The launcher notices a new version
- [ ] 098 — I update when I choose to
- [ ] 099 — About tells me what changed

## Notes

The order is a dependency chain, not a preference: 097 reads the update metadata 096 publishes,
098 acts on the state 097 holds, and 099 renders the notes 096 writes and 097 fetches. A story
later in the chain cannot be verified end-to-end before the one before it exists.

`claude-control` is the reference for 096, not a template to copy blindly: its
`.github/workflows/release.yml` plus `scripts/plan-release.ps1` / `ci-release.ps1` and its
`## Unreleased`-gated `CHANGELOG.md` are the shape to adapt, but its hand-rolled updater
(`src/main/selfUpdate.ts`) exists only because it ships a portable EXE — this project ships NSIS,
which `electron-updater` can install.

Three decisions are deliberately left to the clarification round because they are the user's, not
an agent's: the first release's version and whether beta releases are GitHub prereleases (096),
whether `Hantsch/q2-launcher` is public — 097's check from user machines depends on it — and
whether unsigned artifacts (SmartScreen on every beta user's first install) are accepted for the
beta or a certificate comes first.

096 also flips `changelog-path` in `.claude/ai-scrum.md` from `none` to `CHANGELOG.md`, which makes
a changelog entry part of every user-facing story from the next sprint on — including 097–099
inside this sprint.

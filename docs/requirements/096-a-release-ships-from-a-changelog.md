---
id: 096
title: A release ships from a changelog
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-13
---

## Requirement

The launcher is usable enough to hand to real players, but there is no way to hand it to
them: no tag, no GitHub release, no artifact anyone could download, and no record of what
changed between two builds. Version is still `0.1.0`, the repository has no tags and no
`.github/` at all, and [electron-builder.yml](../../electron-builder.yml) has no `publish`
target — so `package:win` produces an installer that lives and dies on this machine.

A release has to be a single deliberate act that produces the same three things every time:
a version, a published set of artifacts, and a human-readable list of what changed. The
changelog is the source for the release notes, not a byproduct of them — whoever writes a
user-facing change writes its line while the change is fresh, and the release only promotes
what is already there. A release with nothing to say is a mistake, not a valid release.

The sibling project `claude-control` already runs exactly this shape
(`.github/workflows/release.yml` + `scripts/plan-release.ps1` / `ci-release.ps1`, a
`CHANGELOG.md` whose `## Unreleased` section gates the run) and is the reference to adapt —
not to invent from scratch. It differs in one respect that matters: it ships a portable EXE,
this launcher ships NSIS + zip, which is what [[097]]'s updater needs a published
`latest.yml` for.

## Acceptance Criteria

- [ ] **AC1** — The repository has a `CHANGELOG.md` in Keep-a-Changelog shape whose
      `## Unreleased` section is where pending user-facing changes are collected, seeded with
      the entries for everything the beta ships with.
- [ ] **AC2** — A release run refuses to publish while `## Unreleased` is empty, with a
      readable reason, and changes nothing in the repository when it refuses.
- [ ] **AC3** — A release run determines the next version from the pending changes, promotes
      `## Unreleased` into a dated version section, writes that version into `package.json`,
      and leaves `## Unreleased` empty again — all in one commit plus a matching tag.
- [ ] **AC4** — A release run produces the Windows artifacts (NSIS installer, zip) plus the
      update metadata [[097]] reads, and publishes them on a GitHub release whose notes are
      the promoted changelog section.
- [ ] **AC5** — A dry run performs every step including the build and prints the version it
      would release and the notes it would publish, but commits, tags and publishes nothing.
- [ ] **AC6** — A release can be requested with an explicit version and an explicit bump
      level, overriding what the pending changes would have chosen.
- [ ] **AC7** — Running the release twice on unchanged `main` does not produce a second
      release, and the release commit itself never triggers another run.
- [ ] **AC8** — The project's own workflow knows about the changelog: a user-facing story is
      not done without its entry (`changelog-path` in `.claude/ai-scrum.md` points at
      `CHANGELOG.md` instead of `none`).

## Open Questions

- **Which version does the first beta release carry?** Today `package.json` says `0.1.0` and
  there are no tags, so nothing is pinned yet. Options: keep `0.1.0` as the first published
  release, start the beta at `0.9.0`, or use an explicit prerelease line (`1.0.0-beta.1`) with
  GitHub's prerelease flag — which would also decide whether [[097]] has to distinguish a beta
  channel from a stable one, or whether every published release is simply the current one.
- **Is `Hantsch/q2-launcher` public?** [[097]]'s update check reads the release feed from every
  user's machine; against a private repository that only works with a token shipped to users,
  which is not acceptable. If the repository stays private for now, this story has to say so and
  [[097]] needs a different distribution source.
- **Unsigned artifacts.** Nothing in this project is code-signed, so the first run of the NSIS
  installer shows a SmartScreen warning on every beta user's machine, and [[097]]'s installs
  will too. Accept for the beta and say so in the README, or buy a certificate first?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

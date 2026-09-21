---
id: 101
title: a linux release ships and updates itself
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-21
---

## Requirement

A user on Linux downloads a packaged launcher, installs Quake II with it, and is carried forward by
the same update flow a Windows user gets: the launcher notices a new version, the user chooses when
to take it, and it restarts into it.

This is the second half of Linux support and the risky half. Story 100 makes the launcher *work* on
Linux when run from source; this one makes it something a stranger can download. It touches two
things that currently have exactly one proven configuration each — the release ritual
(`scripts/release.mjs`, `scripts/lib/release/artifacts.mjs`, `.github/workflows/release.yml`,
`electron-builder.yml`) and the update path (`electron-updater`, `latest.yml`) — and it takes on an
ongoing obligation the project does not have today: producing an engine binary itself.

That obligation is the core of it. Verified 2026-09-21: upstream `q2pro/q2pro`'s `nightly` release
publishes four Windows zips, a source tarball and a version file — **no Linux binary**. The
third-party Linux builds that exist (Flathub `com.github.skullernet.q2pro`, AUR `q2pro`) are a
sandboxed Flatpak and an Arch source build; neither is an install tree this launcher can lay out,
update, repair or roll back. So either the project builds and mirrors a Linux Q2PRO itself, or
Linux never gets the bootstrap wizard. Full evidence:
[linux-support-analysis.md](../linux-support-analysis.md) §3 B1.

The release-side traps are already documented in the code that will have to change:
`win.artifactName` in `electron-builder.yml` carries a long comment about why a space in the
artifact name breaks the URL `electron-updater` resolves — and the `linux:` block below it is
marked untested and has no `artifactName` at all. `collectAssets` hardcodes the four Windows assets
and *throws* on any set it does not recognise, which is correct behaviour that will refuse the
first multi-platform build.

## Acceptance Criteria

- [ ] **AC1** — A Linux Q2PRO client build exists in the content repository as a pinned,
      size- and SHA256-verified manifest package, produced from the same upstream source the
      Windows pin is cut from, with provenance recorded to the standard the existing packages
      already meet.
- [ ] **AC2** — Producing that build is a repeatable, recorded job rather than a one-off on
      someone's machine: re-running it against the same upstream source yields the same package,
      and what to run is written down where the next person will find it.
- [ ] **AC3** — One release run produces both the Windows and the Linux artifacts. The asset check
      knows both sets, still refuses to publish when any expected file is missing, and names
      exactly which one.
- [ ] **AC4** — The Linux artifact's file name follows the same hyphenated pattern the Windows one
      does, so the name written into the update metadata, the name on disk and the name of the
      uploaded release asset are the same string.
- [ ] **AC5** — `latest-linux.yml` is published alongside `latest.yml`; neither overwrites or
      invalidates the other, and a Windows client never resolves the Linux metadata or vice versa.
- [ ] **AC6** — A packaged Linux build notices a new version on its daily check, and the user can
      choose to take it: it downloads, the launcher restarts, and it comes back up as the new
      version.
- [ ] **AC7** — About shows the real release notes for the running version on Linux, as it does on
      Windows.
- [ ] **AC8** — The UI verification harness runs against the packaged Linux build and produces the
      screenshot set and the axe-core accessibility report it produces on Windows.

## Open Questions

- [ ] **Q1 — Who owns the Linux Q2PRO build, and is a self-built engine acceptable provenance?**
      AC1/AC2 assume the project builds and mirrors it. Every package pinned today is *mirrored
      byte-for-byte from an upstream release*, and the provenance strings say so; a binary this
      project compiled itself is a different trust claim and a standing maintenance duty (rebuild
      when upstream moves, or the Linux pin rots). The alternative is to drop AC1/AC2 and ship
      Linux without a managed install at all — story 100 already makes that a coherent product, it
      just has no download path. This question decides whether this story is large or merely
      medium.
- [ ] **Q2 — AppImage only?** `electron-builder.yml` names AppImage and nothing else. AppImage is
      the only one of the three that self-updates, which AC6 requires; deb/rpm mean distro
      packaging and no self-update; a Flatpak would sandbox the launcher itself, which conflicts
      with managing install trees anywhere on disk. Recommendation: AppImage only, at least first —
      but it should be a decision, not an inherited default.
- [ ] **Q3 — Is 32-bit or ARM in scope?** Upstream Q2PRO still publishes a win32 x86 build and
      Flathub ships aarch64. Assumed out of scope (x86_64 only) unless decided otherwise; it
      affects how many packages Q1's build job has to produce.
- [ ] **Q4 — Who runs the real acceptance?** No Linux machine appears anywhere in the current
      workflow. AC6 in particular cannot be honestly accepted from CI alone — someone has to
      install a real artifact, wait for a real update and watch it restart. Without an answer here,
      AC6 becomes manual residue with nobody to perform it.

## Plan

<!-- Filled by /refine 101, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 101. -->

## Model Hints

<!-- Filled by /refine 101. -->

## Acceptance Tests

<!-- Filled by /refine 101. -->

## Done

<!-- Filled by /build 101. -->

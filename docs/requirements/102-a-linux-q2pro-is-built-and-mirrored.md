---
id: 102
title: a linux q2pro is built and mirrored
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-21
---

## Requirement

A Linux user opens the bootstrap wizard and is offered a Q2PRO to install, the same way a Windows
user is — which means this project produces that binary, because nobody else publishes one it can
use.

Cut out of story [[101]] on 2026-09-21 (its Q1), where it was AC1/AC2. The split is deliberate:
101 is a release and update path that ships on its own, and this is a standing obligation with its
own trust question. Nothing in 101 waits on this story, and nothing here waits on 101.

Verified 2026-09-21: upstream `q2pro/q2pro`'s `nightly` release publishes four Windows zips, a
source tarball (`q2pro-source.tar.gz`) and a version file — **no Linux binary**. The third-party
Linux builds that exist (Flathub `com.github.skullernet.q2pro`, AUR `q2pro`, `q2pro-git`) are a
sandboxed Flatpak and Arch source builds; neither is an install tree this launcher can lay out,
update, repair or roll back, because the whole `downloads` module assumes it owns the directory.
Full evidence: [linux-support-analysis.md](../linux-support-analysis.md) §3 B1.

Story 100 already landed everything on the *consuming* side: the manifest's `platforms` field,
per-platform `pinned` resolution, and the `none-for-platform` bootstrap outcome that is currently
what a Linux user sees. So this story adds no schema and no renderer work — it is a build job, a
mirrored package, and a manifest row.

## Acceptance Criteria

- [ ] **AC1** — A Linux Q2PRO client build exists in the content repository as a pinned,
      size- and SHA256-verified manifest package, produced from the same upstream source the
      Windows pin is cut from, with provenance recorded to the standard the existing packages
      already meet.
- [ ] **AC2** — Producing that build is a repeatable, recorded job rather than a one-off on
      someone's machine: re-running it against the same upstream source yields the same package,
      and what to run is written down where the next person will find it.
- [ ] **AC3** — A Linux user reaches the bootstrap wizard, is offered Q2PRO, and ends up with a
      working install tree — the `none-for-platform` outcome story 100 shipped no longer fires
      for Q2PRO on Linux.
- [ ] **AC4** — R1Q2 is still not offered on Linux, and says so rather than failing.

## Open Questions

- [ ] **Q1 — Is a self-compiled engine acceptable provenance?** Every package pinned today is
      *mirrored byte-for-byte from an upstream release*, and the provenance strings say exactly
      that. A binary this project compiled itself is a different trust claim. Either the
      provenance convention grows a "built by us, from upstream source `<sha>`" shape, or this
      story does not happen.
- [ ] **Q2 — Who rebuilds it when upstream moves?** The Windows pin tracks a `nightly` tag that
      upstream overwrites. A self-built Linux pin that nobody refreshes rots into a version older
      than the Windows one. Is that acceptable drift, a scheduled job, or a documented duty?
- [ ] **Q3 — Where does the build run, and where does the artifact live?** Presumably a job that
      builds with Meson + Ninja and publishes into the existing `Hantsch/q2_community_content`
      repository, which is where every other package is mirrored. Confirm before planning.
- [ ] **Q4 — Reproducibility to what standard?** AC2 says "re-running yields the same package".
      Bit-identical is a high bar for a C build. Is "same sources, same toolchain, recorded
      SHA256 of what was published" enough?

## Plan

<!-- Filled by /refine 102, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 102. -->

## Model Hints

<!-- Filled by /refine 102. -->

## Acceptance Tests

<!-- Filled by /refine 102. -->

## Done

<!-- Filled by /build 102. -->

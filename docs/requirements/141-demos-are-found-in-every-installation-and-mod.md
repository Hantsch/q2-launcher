---
id: 141
title: demos are found in every installation and mod
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user has several installations and plays several mods. Their demos sit in `baseq2/demos/`,
`opentdm/demos/`, `ctf/demos/` — per installation. The Demos view lists all of them in one place,
each labelled with where it lives (concept `docs/concepts/demo-browser.md` §7, DEMO-1, DEMO-2).

Discovery walks every installation (from the installations service) × every game dir `inspector.ts`
detects, and looks in `<root>/<gamedir>/demos/`. Q2PRO's `homedir` defaults to `~/.q2pro` in
system-wide Linux builds (distro/Flatpak), so the installation's **effective write directory** is
scanned too, not only its root. Recognised formats: `.dm2`, `.mvd2`, `.dm2.gz`, `.mvd2.gz`. Sidecars
(`*.json`, [[146]]) are not demos. The launcher's own temporary playback copies
(`demos/_launcher/`, [[160]]) never appear as demos.

This story delivers the discovered list with source labels; parsing results arrive through
[[136]]–[[139]], the incremental index through [[144]], the row itself through [[150]]. It also sets
up the UI-verification fixture: demos are served from a local test folder, and no test touches a
real installation (§14).

## Acceptance Criteria

- [ ] **AC1** — Every `.dm2`, `.mvd2`, `.dm2.gz` and `.mvd2.gz` in `<root>/<gamedir>/demos/` of every
      installation and every detected game dir appears in the list.
- [ ] **AC2** — For an installation whose effective write directory differs from its root (Q2PRO
      `homedir`, e.g. `~/.q2pro` on Linux), demos in `<writedir>/<gamedir>/demos/` appear too, and a
      demo present in both places is not listed twice.
- [ ] **AC3** — Each demo shows its source as installation name + game dir.
- [ ] **AC4** — Sidecar `.json` files and anything under `demos/_launcher/` are never listed as
      demos.
- [ ] **AC5** — Extension matching is case-insensitive (`FINAL.DM2` is found).
- [ ] **AC6** — A `ui:verify`/`ui:flow` fixture serves demos from a local test folder, so the list
      renders with data in e2e runs without any real installation.

## Open Questions

- [ ] **Q1 — Recursion** — only the `demos/` folder itself, or its subfolders too (Q2PRO's `demo`
      command accepts subpaths)?
- [ ] **Q2 — Write directory** — how the launcher learns an installation's effective write
      directory (known per engine/build, or read from the installation's config).

## Plan

<!-- Filled by /refine 141, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 141. -->

## Model Hints

<!-- Filled by /refine 141. -->

## Acceptance Tests

<!-- Filled by /refine 141. -->

## Done

<!-- Filled by /build 141. -->

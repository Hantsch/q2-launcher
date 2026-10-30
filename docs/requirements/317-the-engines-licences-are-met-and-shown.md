---
id: 317
title: The engine's licences are met and shown
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the maintainer I want every third-party component the integrated player ships to come with its
licence text, a source offer and an entry in _About_, so that distribution meets the licences as
far as they are cleared.

Context:

- [concept §12](../concepts/integrated-demo-player.md), points L1–L8. **All are marked for legal
  clarification; this story is not legal advice.** It implements what is cleared and records what
  stays open.
- Precedents: `resources/licenses/r1q2/GPL-3.0.txt` ships for R1Q2 through `extraResources`;
  _About_ already links the GeoIP database licence
  (`src/renderer/src/components/about/AboutPanel.tsx`, `about-link-geoip-licence`).
- Source tarball per release from [[316]].
- Components:
  - Q2PRO (GPLv2 or later, L1/L2)
  - Mediabunny (MPL-2.0, L7)
  - `@mediabunny/aac-encoder` (FFmpeg AAC, LGPL-2.1+; the package's own licence is an
    assumption, L4)
  - ffmpeg, if shipped (L5)
  - H.264/AAC patents (L6)
  - shareware test data (L8)
- Constraints: `resources/licenses/MANIFEST.json`
  (`[{ id, name, license, licenseFile, sourceUrl?, cleared, clearedRef }]`) is the single source
  for the About list, the build-filter test and the docs table. The About section follows
  `AboutPanel.tsx` (`Button variant="link"` + `app:openExternal` for web links); local licence
  texts are opened by main through a new contract-first handler taking a component id, never a
  path. The GPLv2 text comes from the pinned upstream (`COPYING`/`LICENSE`), copied by
  `scripts/engine/build.mjs` to `resources/licenses/q2pro/`. No CHANGELOG entry of its own; the
  About addition is part of the integrated-mode feature line.
- Not in scope: a legal assessment by the agent (open points stay open and only block the
  component they concern); a change of the launcher's MIT licence.
- Depends on: [[316]].

Expected manual residue: a visual check of the About section.

## Acceptance Criteria

- [ ] **AC1** — The unpacked package has `resources/licenses/q2pro/COPYING` (GPLv2 text from the
      pinned upstream) and `resources/licenses/mediabunny/LICENSE` (MPL-2.0) (`npm run package:dir`,
      then list `release/*/win-unpacked/resources/licenses`).
- [ ] **AC2** — When the AAC encoder ships, its `aac-encoder/LICENSE` and the FFmpeg LGPL text are
      there too.
- [ ] **AC3** — A test checks the `extraResources` filters in `electron-builder.yml` against
      `resources/licenses/MANIFEST.json` (`npx vitest run src/main/licenses-manifest.test.ts`).
- [ ] **AC4** — _Settings → About_ has a "Third-party components" section listing every shipped
      component with name, licence and a link to its licence text, all as i18n keys
      (`npx vitest run src/renderer/src/components/about/AboutPanel.test.tsx`).
- [ ] **AC5** — The Q2PRO entry in that section links to the release's source tarball
      (`npm run ui:flow -- about-third-party`).
- [ ] **AC6** — `docs/licensing/integrated-player.md` gives each of L1–L8 a status (cleared / open
      / not applicable), the source of the clearance (person/date, no content of legal advice) and
      the measure taken.
- [ ] **AC7** — A component whose licence point is open (e.g. L4 for the AAC polyfill, L5 for
      ffmpeg) is not in a release package, or stays behind its flag; a unit test reads `cleared`
      from the manifest and checks that only cleared components are in the build filters.
- [ ] **AC8** — If L1 is cleared as "the whole distribution must follow GPLv2", README and About
      point to the complete source (public launcher plus engine tarball); if L1 is cleared
      differently, the measure named there is implemented and recorded under AC6.
- [ ] **AC9** — `npm run ui:verify` has no axe violation in the new section.

## Open Questions

- Legal clarification of L1–L8 by the maintainer or an appointed party: who, by when? Its result
  goes into `docs/licensing/integrated-player.md` and is the precondition for setting `cleared`
  to `true`.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

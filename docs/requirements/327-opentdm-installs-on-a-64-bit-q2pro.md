---
id: 327
title: OpenTDM installs on a 64-bit Q2PRO
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Installing OpenTDM into an installation with a 64-bit Q2PRO is refused with `mods.error.noVariant`,
because the catalog has no variant for it and `contentOnly.packages` is empty (TD-007). A user on
the default 64-bit engine cannot install one of the catalog's mods.

## Acceptance Criteria

- [ ] **AC1** — On an installation with a 64-bit Q2PRO, OpenTDM is offered and installs.
- [ ] **AC2** — The installed OpenTDM is listed in the installation's mods and can be removed.
- [ ] **AC3** — A mod with genuinely no matching variant is still refused with
      `mods.error.noVariant`, shown with its reason.
- [ ] **AC4** — Row TD-007 is removed from `docs/TECH-DEBT.md`.

## Open Questions

~~Which way: a content-only variant (if the 64-bit Q2PRO can run OpenTDM's game logic as shipped),~~ answered → Decisions (Sprint)
  or a 64-bit OpenTDM build mirrored like the other packages?

- ~~**Q2 (refine, S37) — the probe rules out both branches of the binding decision as stated; which
  way now?**~~ answered → Decisions (Sprint). Findings (2026-10-30):
  - OpenTDM is a pure game library: r388 ships only `gamex86-opentdm-r388~add8f3c.dll` (32-bit
    PE) + `example-opentdm.cfg` for Windows, and `gamex86_64-…so` for Linux
    (`content/q2_community_content/mods/manifest.json`; GitHub release assets checked). A 64-bit
    Q2PRO process cannot load a 32-bit DLL (Windows refuses mixed bitness in one process), so the
    shipped game logic does **not** run → the content-only branch's condition fails.
  - There is **no upstream 64-bit Windows build to mirror** (only `opentdm-r388-win32.zip` and
    `opentdm-r388-linux-x86_64.tar.gz` exist). "Mirrored like other packages" (R1Q2, Q2PRO
    nightly) means re-hosting an existing upstream binary; here we would have to **build** one
    (mingw-w64 x86_64 cross-compile of r388/add8f3c — its Makefile only knows i686 Windows, its
    `deps/win32` libcurl stack is 32-bit, and LLP64 has never been exercised for this code), then
    the maintainer uploads it to a `Hantsch/q2_community_content` release (an upload is the
    user's action, not an agent's).
  - Options:
    - **A — content-only variant (concept `docs/concepts/mods.md` §3 "No matching build", §OpenTDM
      row):** `contentOnly.packages` gets the win32 zip with only `example-opentdm.cfg` → gamedir;
      the existing content-only path shows "Not playable locally with Q2PRO 64-bit: no matching
      build"; joining OpenTDM servers works. One small manifest + test story, no hard D.
    - **B — self-built 64-bit OpenTDM:** a reproducible Docker build script, a probe that 64-bit
      Q2PRO loads it and runs a local OpenTDM match, the user's release upload, then a `win32/x64`
      variant with its sha256. We become the maintainer of a binary nobody upstream ships; this
      needs two hard Ds (the LLP64/curl build, the in-engine proof) → would be split.
    - **C (recommended) — A now, B as a separate follow-up story** if local OpenTDM play on 64-bit
      Q2PRO is wanted: AC1–AC4 hold with A (OpenTDM is offered, installs, is listed/removable,
      TD-007 gone), and the honest "not playable locally" reason follows the concept.

## Decisions (Sprint)

- **(User)** no 64-bit OpenTDM upstream (Q2): option A — content-only variant (example-opentdm.cfg) with the visible "not playable locally" reason; no follow-up story for an own 64-bit build

- **(User)** OpenTDM on 64-bit Q2PRO: agent decides in refine after probing: content-only variant if 64-bit Q2PRO runs the shipped game logic, else a 64-bit build mirrored like other packages
- Probe result: the content-only condition is false and no 64-bit build exists to mirror, so the
  binding decision has no executable branch — escalated as Q2 rather than re-decided, because
  building and hosting our own binary is a supply-chain and design call that belongs to the user.
- The content-only package re-uses the r388 win32 zip (same url, size, sha256) under its own id
  `opentdm-r388-win32-content` with `contents` = only `example-opentdm.cfg`, because the concept's
  OpenTDM row asks for exactly that and no second download source has to be trusted.
- The visible reason is the existing `mods.reason.notPlayableLocally` and the refusal the existing
  `mods.error.noVariant`; no new i18n key, because both already state the reason as visible text.
- Any engine without a matching library variant (also a 32-bit Linux engine) now gets the same
  content-only install with that reason, because `selectVariant` is engine-agnostic and an honest
  content-only install beats a refusal for a mod used mainly to join servers.
- AC1–AC3 extend the existing `mods-install-content-only` flow (no new flow), because it already walks
  this user path; the harness cannot download the real GitHub zip, so the real catalog entry is
  proven by a unit test over the shipped manifest.
- Publishing the edited `mods/manifest.json` to `Hantsch/q2_community_content` (fetched by the app at
  runtime) is the maintainer's push, outside this story, because agents do not push.

## Plan

Catalog data plus acceptance coverage; the content-only install path, its reason text and the
refusal already exist (`engine-target.ts` `selectVariant`, `ModInstallState.tsx`).

1. `content/q2_community_content/mods/manifest.json`: OpenTDM r388 gets one `contentOnly` package
   (win32 zip, only `example-opentdm.cfg` → gamedir). A 64-bit Q2PRO then gets the content-only
   install and the visible "Not playable locally with Q2PRO 64-bit: no matching build"; 32-bit
   Windows and Linux x64 keep their library variants.
2. Unit tests over the shipped manifest prove that selection for the real entry.
3. `TD-007` leaves `docs/TECH-DEBT.md`; one `### Fixed` line in `CHANGELOG.md`.
4. The mods-install fixture catalog gains a mod with a 32-bit-only variant and no content-only
   package; the existing `mods-install-content-only` flow gets two steps: removing the content-only
   install (AC2) and the visible `noVariant` refusal for that mod (AC3).

D1 and D2 are independent. No IPC, no renderer code, no systems-doc change (`docs/systems/mods-module.md`
lists no catalog entries; `docs/concepts/mods.md` §OpenTDM row already describes this outcome).

## Deliverables

- **D1 — OpenTDM gets a content-only package.** Files:
  `content/q2_community_content/mods/manifest.json`, `src/main/modules/mods/shipped-manifest.test.ts`,
  `docs/TECH-DEBT.md`, `CHANGELOG.md`.
  - In the `opentdm` entry, version `r388`, replace `"contentOnly": { "packages": [] }` with one
    package: `id` `opentdm-r388-win32-content`, `version` `r388`; `url`, `mirrors`, `sizeBytes`,
    `sha256` copied unchanged from the existing `opentdm-r388-win32-x86` package (same zip);
    `contents: [{ "from": "example-opentdm.cfg", "to": "gamedir" }]` only — never the DLL. Leave
    both library variants untouched.
  - Tests in `shipped-manifest.test.ts` (parse the shipped file like the existing test, then call
    `selectVariant` from `./engine-target` on the opentdm `r388` version):
    "OpenTDM on a 64-bit Windows Q2PRO installs content-only with only its example config" (target
    `{ platform: 'win32', arch: 'x86_64', engineKind: 'q2pro' }` → `contentOnly: true`, the packages'
    `contents[].from` are exactly `['example-opentdm.cfg']`); and "OpenTDM on a 32-bit Windows engine
    still installs its game library" (target `win32` / `x86` / `r1q2` → `contentOnly: false`).
  - Delete row `TD-007` from `docs/TECH-DEBT.md` (only that row).
  - `CHANGELOG.md` under `## Unreleased` → `### Fixed` (create the heading if absent), one line, e.g.
    `- OpenTDM installs on 64-bit Q2PRO — config only, not playable locally there.`
  - Acceptance: `npx vitest run src/main/modules/mods` green; `rg TD-007 docs/TECH-DEBT.md` empty.
- **D2 — the content-only flow also removes, and shows a refusal.** Files:
  `scripts/lib/fixture/mods.mjs`, `scripts/flows/mods-install-content-only.mjs`.
  - In the mods-install fixture catalog (the `entry(...)` list holding `fixturemod` / `fixturebad`,
    ~line 93) add `entry('fixturenovariant', 'Fixture No Build Mod', { variants: [{ platform:
    HOST_PLATFORM, arch: 'x86', packages: [pkg('fixturenovariant-win32-x86', library)] }],
    contentOnly: { packages: [] } })`. First grep `scripts/flows/` for flows on this catalog
    (`modsInstallLifecycle`) that count tiles or entries, and adjust any count that moves.
  - Extend `mods-install-content-only.mjs` after its record check (same q2pro installation):
    step "remove the content-only install": `fixturemod` detail → `mods-detail-remove` → confirm
    (`mods-remove-confirm`, see `RemoveModDialog.tsx`), wait until the tile no longer shows installed;
    assert `fixturemod/pak0.pak` is gone and `installRecords(MODS_INSTALL_Q2PRO_ID)` is empty.
    Step "a mod with no build for the engine is refused with its reason": click
    `mods-install-fixturenovariant`, wait for `mods-tile-status-fixturenovariant` with the visible
    text `This mod has no build for your engine.`; assert no `fixturenovariant` folder and no record.
  - Update the flow's header comment to say what it now proves.
  - Acceptance: `npm run ui:flow -- mods-install-content-only` green.

## Model Hints

All Ds default tier (a catalog data edit plus two steps on an existing flow with existing selectors).

Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/mods/shipped-manifest.test.ts` › "OpenTDM on a 64-bit Windows Q2PRO
  installs content-only with only its example config" (the real entry, D1) + e2e
  `scripts/flows/mods-install-content-only.mjs` › "mods-install-content-only" (user path: offered,
  installs content-only, reason visible on tile and detail; D2).
- AC2 → e2e `scripts/flows/mods-install-content-only.mjs` › "mods-install-content-only" (listed as
  installed, removed from the detail panel, files and record gone; D2).
- AC3 → e2e `scripts/flows/mods-install-content-only.mjs` › "mods-install-content-only"
  (`fixturenovariant` refused, "This mod has no build for your engine." visible; D2) + existing unit
  `src/main/modules/mods/engine-target.test.ts` (refusal key `mods.error.noVariant`); the real
  catalog's library path is guarded by `shipped-manifest.test.ts` › "OpenTDM on a 32-bit Windows
  engine still installs its game library" (D1).
- AC4 → doc check by D1: `rg TD-007 docs/TECH-DEBT.md` returns nothing (a deleted doc row has no
  behaviour to test).

## Done

---
id: 076
title: The bootstrap assembles the real archives, not the fixtures
status: draft
created: 2026-09-08
---

## Requirement

[[074]]'s bootstrap wizard fails on a real machine. Every download succeeds and verifies, every
extraction exits 0, and the run still ends with `downloads.error.installationNotPlayable` and a
target directory that is empty after cleanup.

The cause is not the network and not the extractor: `assemble.ts`'s allowlist
([assemble.ts:52](../../src/main/modules/downloads/bootstrap/assemble.ts#L52)) was written
against [[074]] D8's synthetic fixture archives (`scripts/lib/fixture.mjs`), and the real
archives are laid out differently. The file's own doc comment already flags this as "still
unverified residue" and carries a `TODO` about the engine's game-module filename — this story is
that residue coming due.

Measured on 2026-09-08 against the three archives the shipped manifest actually pins, extracted
with the vendored `resources/bin/7za.exe`:

| Package | Allowlist expects | Real layout | Result |
| --- | --- | --- | --- |
| `q2-314-demo-x86.exe` | `baseq2/pak0.pak` | `Install/Data/baseq2/pak0.pak` (49.9 MB) | not copied |
| `q2pro-client_win64_x64.zip` | `q2pro.exe` | `q2pro64.exe` at the zip root | not copied |
| `q2pro-client_win64_x64.zip` | `baseq2/gamex86_64.dll` | `baseq2/gamex86_64.dll` | correct |
| `q2-3.20-x86-full-ctf.exe` | `baseq2/pak2.pak` | `baseq2/pak2.pak` | correct |
| `q2-3.20-x86-full-ctf.exe` | *(not in the allowlist)* | `baseq2/pak1.pak` also ships | never copied |
| either package | `players/` at the source root | `baseq2/players/` in both | not copied |
| either package | `video/` at the source root | present in neither | nothing to copy |

The demo *is* fully extractable — the earlier suspicion that its InstallShield `data1.cab` blocks
7za is wrong; that CAB is a 2.5 KB stub and the payload sits uncompressed under `Install/Data/`.
So no new extraction tooling is needed. What is needed is an allowlist that matches reality, and
a failure that says which package came up empty instead of only reporting the verdict at the very
end (that half is [[075]]'s job; the two stories meet at the same run).

AC8 of [[074]] stays untouched: the fix is more literal entries, never a recursive copy or a
search — `ctf/`, `xatrix/` and `rogue/` must still be impossible to pull in.

## Acceptance Criteria

- [ ] **AC1** — A bootstrap run against the three really pinned archives produces an installation
      whose `inspectInstallation` verdict is neither `invalid` nor `missing`, containing at
      minimum the engine binary, `baseq2/pak0.pak`, `baseq2/pak1.pak` and `baseq2/pak2.pak`.
- [ ] **AC2** — The allowlist covers the real source paths from the table above; every added
      entry is a literal relative path, and nothing outside the allowlist is ever read or copied.
- [ ] **AC3** — The engine binary is copied under the name the target expects, whatever the
      release zip calls it — `q2pro64.exe` today, without hard-coding an assumption that the two
      names always agree.
- [ ] **AC4** — `players/` is sourced from `baseq2/players/` and lands at `baseq2/players/`; the
      absence of `video/` in every real archive is a normal outcome, not a failure.
- [ ] **AC5** — When an allowlisted file required for playability is missing from every source
      dir, the job fails naming *that package*, not the generic end-of-run verdict — and the
      reason survives into [[075]]'s diagnostics.
- [ ] **AC6** — [[074]] D8's fixture archives are re-laid-out to mirror the real ones, so
      `scripts/flows/bootstrap-wizard.mjs` stops passing against a layout that does not exist.
      A fixture that disagrees with reality is what let this ship.
- [ ] **AC7** — A test pins each real archive's relevant layout facts (the paths in the table),
      so a future manifest re-pin that changes a layout fails a test instead of a user's install.

## Open Questions

- Does `q2pro-client_win64_x64.zip` also ship `q2ded64.exe`, and does the launcher want it? The
  measured listing showed only `q2pro64.exe`, `baseq2/gamex86_64.dll`, `baseq2/q2pro.menu` and
  three text files.
- Should `baseq2/q2pro.menu` be part of the allowlist? It is engine configuration, not game data.
- AC7 needs the archives available in CI. Pin checksums and skip offline (like the existing
  7za-gated skips), or check tiny recorded listings into the repo instead of the archives?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

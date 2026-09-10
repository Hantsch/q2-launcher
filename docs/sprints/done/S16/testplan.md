# Sprint S16 Testplan — manual residue

`testplan: optional` per the project profile: only criteria marked manual residue land here.
Everything else in this sprint was proven by an automated test — see `review.md`'s Acceptance
section.

## 070-AC6 — Publish the manifest and the mirrored Q2PRO asset to the public content repository

**Why this can't be automated:** publishing requires push access to
`Hantsch/q2_community_content` and the authority to upload a public GitHub release asset —
credentials this build environment does not have. The manifest content and its hashes were fully
verified against the real, live-published upstream assets (`node scripts/manifest-hashes.mjs
--check` exits 0); only the act of publishing is left.

**Preparation:**
- Push access to `Hantsch/q2_community_content` on `main`.
- The reviewed, byte-identical files already in this repo at
  `content/q2_community_content/{engines,gamedata}/manifest.json`.
- The Q2PRO nightly asset pinned in the manifest (`q2pro-client_win64_x64.zip`, version
  `r3834~601a8df8`) downloaded from upstream for re-upload.

**Steps:**
1. Commit `content/q2_community_content/engines/manifest.json` and
   `content/q2_community_content/gamedata/manifest.json` to `Hantsch/q2_community_content`'s
   `main` branch, under the same `engines/`/`gamedata/` paths.
2. Create a release in `Hantsch/q2_community_content` and upload the downloaded Q2PRO nightly
   asset to it, so the manifest's primary URL (the mirror) resolves to a real, immutable file.
3. Run `node scripts/manifest-hashes.mjs --check` against the now-published repository URLs.

**Expected result:** the check exits 0 for all three packages, confirming the published files
match the sizes and SHA256 hashes already recorded in the manifest and verified in story 070's
`Done` section.

# Sprint S21 — manual test plan

Only the criteria marked `manual residue` in [review.md](review.md) land here — everything else
in the sprint is proven by an automated test. Neither of these blocks the sprint or story 096/098;
they are listed so someone can walk them once real infrastructure exists to walk them on.

## 096 AC4 — the release actually publishes to GitHub

**Why manual:** creating a real GitHub release is an external-service side effect; no automated
test may perform it against the live repository.

**Preparation:** a clean `## Unreleased` section with at least one real entry, a GitHub token
with `contents: write` on `Hantsch/q2-launcher` available as `GH_TOKEN`, and a machine with `gh`
and the repo's toolchain installed.

**Steps:**
1. Run `node scripts/release.mjs --dry-run` and confirm the printed version/notes look right.
2. Trigger the `release.yml` workflow (`workflow_dispatch`, or push to `main` with a
   non-empty `## Unreleased`).
3. Watch the run to completion.

**Expected result:** a new tag `v1.0.0-beta.1` (or the next derived version) exists on
`Hantsch/q2-launcher`, a GitHub prerelease exists with the NSIS installer, the zip, both
`.blockmap`s and `latest.yml` attached, and its notes match the promoted changelog section.
`CHANGELOG.md`/`package.json` on `main` show the promoted version and an empty `## Unreleased`.

## 098 AC8 (second half) — a real restart relaunches into the new build

**Why manual:** needs a packaged NSIS install; the acceptance harness runs the unpackaged build,
where update checks are disabled by design (097 AC5).

**Preparation:** an installed, older packaged build of the launcher on a real Windows machine,
plus a newer published release to update to (see the residue above).

**Steps:**
1. Launch the older installed build and let it complete its daily update check (or trigger one
   by hand from About).
2. Open the titlebar's update control, start the download, wait for it to finish.
3. Confirm restart-and-install a second time.

**Expected result:** the launcher closes, the NSIS installer runs unattended, and the launcher
reopens running the new version — the titlebar's update control is gone and About shows the new
version's own notes.

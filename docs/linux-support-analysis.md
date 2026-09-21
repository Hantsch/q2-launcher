# Linux support — analysis

**Status: background for stories [100](requirements/100-the-launcher-runs-on-linux.md) and
[101](requirements/101-a-linux-release-ships-and-updates-itself.md), both `draft`.** This document
is deliberately parked at the `docs/` root rather than in `concepts/`, because a concept carries a
line in [ROADMAP.md](ROADMAP.md) and that would mean the topic has been prioritised — it has not.
Two draft stories exist; no sprint is cut and no roadmap row is written. If the topic is adopted,
this file becomes `concepts/linux-support.md` plus one roadmap row.

It exists because the two stories rest on external facts that were verified once, on a specific
day, and will not stay true — see the note at the foot of this file.

**Decision already taken (2026-09-21):** Q2PRO is the Linux primary engine. R1Q2 stays
Windows-exclusive — its pinned build is an MSVC Windows binary and its setup path is built around
Windows specifics (see B3).

---

## 1. Verdict up front

The launcher's own code is close to portable. Case sensitivity, registry access, drive enumeration
and path candidates are already branched on `process.platform`, and the UI has no Windows
dependency at all (no image assets, bundled fonts, frameless window).

The blocker is **engine supply**, not engine code: there is no Linux Q2PRO binary the launcher can
install. Everything else on the list is ordinary porting work.

## 2. What is already platform-aware

| Concern | Where | State |
| --- | --- | --- |
| Case-insensitive path compare | `src/main/lib/fs-utils.ts:90`, `src/main/ipc/app.ts:107`, `src/main/modules/downloads/diagnostics.ts:81` | Branches on platform, correct |
| Windows registry | `src/main/lib/win-registry.ts:25` | Returns `[]` off-Windows |
| GOG / Epic detection | `src/main/services/detection/providers.ts:119,158` | Skipped off-Windows |
| Drive enumeration | `src/main/services/detection/deep-scan.ts:115` | Returns `/` off-Windows |
| Common install paths | `src/main/services/detection/providers.ts:158` | Already has `/usr/share/games/quake2`, `/opt/quake2`, `~/quake2`, `~/.yq2` |
| Window icon | `src/main/window.ts:56` | Picks `icon.png` off-Windows |
| Engine executable names | `src/shared/types/engine.ts` | Extension-less variants (`r1q2`, `q2pro`, `quake2`) already listed |
| Renderer | all of `src/renderer` | No platform dependency found |

## 3. Blockers

### B1 — No Linux Q2PRO binary exists to install *(the decisive one)*

`content/q2_community_content/engines/manifest.json` pins two Windows-only packages
(`q2pro-nightly-win64`, `r1q2-b8012-msvs2022-win32`) and a flat `pinned` map with no platform
dimension.

Verified 2026-09-21 against upstream: the `q2pro/q2pro` `nightly` release (published 2025-12-11)
publishes **six assets, none of them Linux** — `q2pro-client_win32_x86.zip`,
`q2pro-client_win64_x64.zip`, `q2pro-server_win32_x86.zip`, `q2pro-server_win64_x64.zip`,
`q2pro-source.tar.gz`, `version.txt`. Upstream CI produces Windows binaries and a source tarball
only.

Third-party Linux builds do exist, but none of them fit this launcher's model:

- **Flathub** (`com.github.skullernet.q2pro`, x86_64 + aarch64) — a sandboxed Flatpak. The launcher
  cannot lay out, update, repair or roll back a Flatpak install tree; the whole `downloads` module
  assumes it owns the directory. Usable as a *detected existing* installation, not as a managed one.
- **AUR** (`q2pro`, `q2pro-git`) — Arch-only, source-built on the user's machine, and the packaging
  has moved the data path (`/usr/share/games/q2pro` → `/usr/share/q2pro`). Same category as Flathub.
- **Debian/Ubuntu** — no package.

So there are exactly two ways to give the Linux bootstrap wizard something to install:

1. **Build it ourselves.** A CI job (Meson + Ninja) builds Q2PRO from the pinned
   `q2pro-source.tar.gz` and publishes a `q2pro-client_linux_x86_64.tar.gz` into
   `Hantsch/q2_community_content`. This fits the existing pipeline exactly — it becomes an ordinary
   manifest package with `contents: [{ "from": ".", "to": "root" }]`, and nothing in
   `pipeline.ts`/`assemble.ts` needs to know it is Linux. Cost: a new build+mirror job, and the
   ongoing obligation to keep it current.
2. **Ship Linux without the download path.** Detect and manage a system-installed Q2PRO
   (Flatpak/AUR/distro), disable the bootstrap wizard on Linux. Much smaller, but it removes the
   launcher's headline feature on that platform.

This is the one open question that changes the size of everything downstream. See §6.

### B2 — `7za.exe` is hardcoded

`BINARY_NAME = '7za.exe'` in `src/main/modules/downloads/7za-path.ts`, the `extraResources` filter
in `electron-builder.yml`, and `scripts/fetch-7za.mjs` all vendor the Windows binary only.

7-Zip publishes official Linux console binaries (verified 2026-09-21, v26.03):
`7z2603-linux-x64.tar.xz`, `-x86`, `-arm64`, `-arm`; the binary inside is `7zz`. Note the CLI
differs slightly from `7za` — `extractor.ts`'s fixed argument shape (`x`, `-o<dir>`, `-y`, `-bsp1`)
needs re-verifying against `7zz`, not assumed.

Licensing is worth a look before vendoring: 7-Zip is LGPL with an additional unRAR restriction, and
the current shipping arrangement already copies `License.txt` beside the binary.

Good news: the pinned gamedata packages are Windows self-extracting `.exe` installers, but the
pipeline only ever *extracts* them, never runs them — so they work unchanged on Linux.

### B3 — R1Q2 setup is Windows-specific

`src/main/modules/downloads/bootstrap/r1q2-setup.ts` probes `vcruntime140.dll` under
`SysWOW64`/`System32` and seeds `set vid_ref "r1gl"` because the pinned package ships
`ref_r1gl.dll`. With the Q2PRO decision this is not work to *do* — it is work to *fence off*: the
R1Q2 engine option must not be offered on Linux at all, rather than being offered and then failing.

### B4 — Steam detection is dead on Linux

`findSteamRoot()` (`src/main/services/detection/providers.ts:27`) resolves only through the
registry. Linux Steam roots (`~/.steam/steam`, `~/.local/share/Steam`, and the Flatpak path
`~/.var/app/com.valvesoftware.Steam/.local/share/Steam`) are missing. The rest of the Steam path —
`libraryfolders.vdf` parsing, `steamapps/common` scanning — is already platform-neutral, so this is
a small, well-contained fix. Worth having: Steam is how most Linux users own Quake II.

### B5 — Release pipeline is Windows-only

- `.github/workflows/release.yml` runs a single job on `windows-latest` calling `package:win`.
- `scripts/release.mjs:334` hardcodes `npm run package:win`.
- `scripts/lib/release/artifacts.mjs` hardcodes the four expected Windows assets and `latest.yml`;
  it *throws* when the set does not match, so it will refuse any multi-platform build.
- `electron-builder.yml`'s `linux:` block is explicitly commented as untested and has **no
  `artifactName`** — which is precisely the trap the `win.artifactName` comment documents at length
  (spaces in the product name break the `latest.yml` URL that electron-updater resolves).
- electron-updater needs a separate `latest-linux.yml`, and AppImage auto-update has its own
  relaunch behaviour (it re-executes via the `APPIMAGE` env var) that has never been exercised here.

### B6 — The test suite is not green on Linux

`src/main/modules/downloads/diagnostics.test.ts:47` asserts `expect(process.platform).toBe('win32')`
literally. `installations.test.ts:291` and `extractor.test.ts:157` branch, which is fine, but the
diagnostics assertion is a hard failure. Until this is fixed, "does it work on Linux" cannot even be
asked of CI.

### B7 — Smaller items

| Item | Where | Note |
| --- | --- | --- |
| `looksExecutable()` guesses via "no dot in the name" off-Windows | `src/main/lib/fs-utils.ts:163` | Should check the executable bit instead |
| yquake2 markers are `.dll` names | `src/shared/types/engine.ts` | `ref_gl3.so`, `game.so` on Linux; only matters if yquake2 classification should work |
| `ui:verify` / Playwright harness | `scripts/verify.mjs`, `scripts/ui-verify.mjs` | Needs xvfb (or headless GL) to run on a Linux CI runner |
| R1Q2 `writeDirStrategy: 'install-dir'` | `src/shared/types/engine.ts` | Fine on Linux as long as installs live under `$HOME`; worth an explicit check that the default install root is not a system path |
| Wizard target verdict applies Windows rules unconditionally | `src/main/modules/downloads/bootstrap/target.ts` | NTFS reserved device names (`aux`, `con`, `nul`, …) and the `\\.\` device-path regex are checked on every platform; on Linux a folder named `aux` is perfectly legal and would be refused. Harmless in practice, wrong in principle |
| `generate-installation-logos.ps1` | `scripts/` | PowerShell-only, but a dev-time asset script — not a runtime blocker |

## 4. Story slice

Two stories, written 2026-09-21. Calibrated against this repo's actual story size — story 096 (*a
release ships from a changelog*) carries 11 acceptance criteria and 6 deliverables and touches
scripts, `electron-builder.yml`, a CI workflow, README and CONTRIBUTING. Against that yardstick the
blockers in §3 are two stories, not eight.

| # | Story | Status | Covers | Blocked on |
| --- | --- | --- | --- | --- |
| [100](requirements/100-the-launcher-runs-on-linux.md) | the launcher runs on linux | draft | B2, B3, B4, B6, B7 | — |
| [101](requirements/101-a-linux-release-ships-and-updates-itself.md) | a linux release ships and updates itself | draft | B1, B5 | Q1, Q4 |

The dividing line is evidential, not thematic: **100 is everything the existing test suite can
prove on a CI runner; 101 is everything that needs a real Linux artifact, a real Linux engine
binary and a real Linux machine.** That is why 100 does not wait on the engine-supply decision —
its AC7 turns "no installable engine on this platform yet" into an explicit, shippable outcome, so
a Linux user can run the launcher against their own Flatpak/AUR/distro Q2PRO while 101 is still
undecided.

## 5. Effort shape

100 is mostly mechanical: every piece has a clear boundary and all of it is testable without a real
Linux release. 101 is the risky half — it takes on an ongoing engine-build obligation the project
does not have today, and it rewrites parts of a release path that currently has exactly one proven
configuration.

## 6. Open questions

The engine-supply, packaging-target, architecture-scope and who-tests-it questions now live in
[story 101](requirements/101-a-linux-release-ships-and-updates-itself.md)'s `Open Questions`, where
`/refine` will require them to be resolved before that story can go `ready`. They are not repeated
here, so there is one place to answer them.

One question belongs to neither story and stays here:

**Does R1Q2 stay Windows-only forever, or is a Linux R1Q2 build a later option?** This decides
whether story 100's AC5 platform dimension is a temporary filter over a Windows-only manifest or a
permanent part of the manifest schema. Nothing blocks on it today — the schema change is the same
either way — but the answer changes how much weight that field should carry later.

---

*Facts about upstream Q2PRO assets and 7-Zip Linux binaries verified live on 2026-09-21; both are
external and can change.*

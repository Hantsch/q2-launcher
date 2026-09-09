# Sprint S17 Testplan — manual residue

`testplan: optional` per the project profile: only criteria marked manual residue land here.
Everything else in this sprint was proven by an automated test — see `review.md`'s Acceptance
section.

## 076-AC1 — Run the bootstrap wizard against the real, live archives on the public mirrors

**Why this can't be automated:** the offline flow proves AC1 against fixtures re-laid-out to the
measured real archive layouts, and `archive-layouts.test.ts` pins those layouts against the
shipped manifests, so a future re-pin that changes a layout fails a test instead of a user's
install. But the same run against the actual ~190 MB archives on the public Q2PRO/id-Software
mirrors depends on two external services and would download ~190 MB per suite run — not something
to automate into a test suite.

**Preparation:**
- A machine with internet access and the manifest's currently-pinned package versions still live
  at their mirrors.
- A clean target directory with no pre-existing installation.

**Steps:**
1. Launch the app and open the bootstrap wizard from the Library.
2. Pick Q2PRO, accept the defaults, and point the target at the clean directory.
3. Let the wizard download, verify, extract and assemble all three packages for real.

**Expected result:** the wizard reaches its success step; the target directory contains the
engine binary under the name Q2PRO expects, plus `baseq2/pak0.pak`, `baseq2/pak1.pak` and
`baseq2/pak2.pak`; the installation appears in the Library as playable (`inspectInstallation`
verdict neither `invalid` nor `missing`).

## 078-AC5 — Reveal-log opens a real OS file-manager window

**Why this can't be automated:** `shell.showItemInFolder` opens an out-of-process OS window
(Windows Explorer) that Playwright's Electron driver cannot see or assert against. Everything
else about reveal-log — that it is reachable only from the expanded failure detail, that it is
disabled until `AppInfo` loads, that it still targets `appInfo.logPath` — is covered by automated
tests; only the window actually appearing is left. This is unchanged residue carried over from
[[075]]'s AC5, not new to this sprint.

**Preparation:**
- A failed download or bootstrap run so a failure entry with diagnostics exists in the Downloads
  tab (or seed one via the same fixture `downloadFailureWithDiagnostics()` the e2e flows use).

**Steps:**
1. Open the Downloads tab and locate the failed entry.
2. Expand its cause detail.
3. Click "Reveal log" in the detail's footer.

**Expected result:** the OS file manager opens a window at the log file's containing folder, with
the log file itself visible/selected.

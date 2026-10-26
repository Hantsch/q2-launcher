# Sprint S34 — Testplan (manual residue only)

Only what cannot be automated. Everything else is covered by the tests listed in `review.md`.

## 1. Story 244 AC9 — delete goes to the real OS trash

**Why manual:** the harness replaces `shell.trashItem` with a move into `<userData>/harness-trash/`, so no test ever
touches the Windows Recycle Bin or a Linux desktop trash. Unit tests (`os.test.ts`, `demo-file-ops.test.ts`) prove
that the call is made and that a rejection is reported per demo and never falls back to deleting.

**Preparation:**

- A real Windows desktop with a Recycle Bin, and separately a Linux desktop with a trash (file manager Trash).
- The launcher with an installation whose demo folder is a throwaway copy: at least three demos, one of them with a
  sidecar `.dm2.json` beside it, and one subfolder holding two demos.

**Steps:**

1. Open the Demos view and select two demos with Ctrl-click (one with a sidecar). Choose Delete and confirm.
2. Open the Recycle Bin (Windows) or the Trash (Linux) in the file manager.
3. Right-click the subfolder row, choose "Delete folder…" and confirm.
4. Look at the trash again, then restore one demo from the trash and rescan in the launcher.

**Expected:**

- Step 1: the launcher shows a per-demo outcome (deleted) and the rows disappear.
- Step 2: both demos and the sidecar appear in the OS trash; they are not gone for good.
- Step 3: the folder goes to the trash with everything in it; its rows disappear and the folder leaves the list.
- Step 4: the restored demo is listed again after the rescan.
- On a Linux desktop without a trash, each demo is reported as failed and stays on disk (never removed).

## 2. Story 237 — the volume slider changes the real sound

**Why manual:** the harness engine is a stub with no audio output; flow `replays-volume` proves the slider, the
coalesced `s_volume` lines, the restore and the remembered level, not that anything is audible.

**Preparation:**

- A machine with an audio device and an installation with a real Q2PRO engine.
- At least two demos in the Demos view; note the installation's current `s_volume` (Settings or the raw config).

**Steps:**

1. Play a demo on the stage. Drag the volume slider from 100 down to about 20, then to 0 and back up.
2. Click the speaker button to mute, then click it again.
3. Stop the demo (session ends) and check the installation's `s_volume` in its config.
4. Play the second demo.

**Expected:**

- Step 1: the loudness follows the slider smoothly, with no clicks or stutter while dragging; at 0 it is silent.
- Step 2: mute silences the game and the second click restores the previous level.
- Step 3: after the session the installation's `s_volume` is back at the value you noted.
- Step 4: the second demo starts at the level last set on the slider.
- Linux: repeat once on a Linux host; its `q2config.cfg` path is not exercised by any test on the Windows runner
  ([TD-044](../../TECH-DEBT.md)).

## 3. Story 234 AC3, GitHub half — real-runner shard times and `windows-verify`

**Why manual:** it needs the workflows to run on GitHub, which means a pull request into `main` or a workflow
dispatch; agents do not push or open pull requests. This follows D2 (the real local rehearsal), which is blocked until
Docker Desktop is running; that is an open task of story 234, not manual residue.

**Preparation:**

- Docker Desktop started and story 234 D2 finished (`npm run rehearse`, poll with `-- --status`).
- The user's own decision to open a pull request or dispatch the `ui-flows` and `windows-verify` workflows.

**Steps:**

1. Dispatch (or open the pull request for) the workflows from the branch under test.
2. Read each of the four `ui-flows` shard durations and the `windows-verify` result.

**Expected:**

- Every shard finishes well under the workflow's `timeout-minutes: 20` (the local margin is 15 minutes).
- `windows-verify` is green once on `windows-latest`.
- If a shard is over the margin or a Linux-only flow is red, note it as a finding for story 234 and the quarantine list.

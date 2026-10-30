---
description: Checks whether a PR of this branch into the release branch, and the release after it, would pass — on the merge, in a throwaway clone, with every blocking CI step under CI conditions. Prints `releasable: yes | NO | UNVERIFIED`. `/sprint` runs it at the start (base) and as its last step (full).
argument-hint: [base]
model: sonnet
effort: medium
---

<!-- ai-scrum:managed 4.10.0 - plugin-owned, written by /ai-scrum:setup. Do not edit:
     setup diffs this file on update and asks before replacing it. Project facts go in .claude/ai-scrum.md. -->

Check whether this branch is releasable. Argument: **$1** — `base` runs only the cheap part
(seconds: what the release branch has that this branch lacks, a merge conflict, the release
notes, the planned version); empty runs everything.

## What this answers, and what it does not

GitHub does not check the branch. A pull request's checks run on the **merge** of the branch into
the release branch, and the release runs on the release branch after that merge. Whatever this
machine checks on `HEAD` alone can be green while both are red: the release branch carries a
commit the branch lacks (the bot's release commit is the usual one — after it, the branch is a
different tree), the pipelines run steps no local suite runs (a notes check, packaging, the
release script itself), and the runner is a different machine (`CI=true`, `TZ=UTC`, a short
`TEMP`, no credentials). Each of those has turned a local `releasable: yes` into a red PR or a red
release. So this command rebuilds what GitHub will run, as closely as one machine can, and says
honestly where it could not.

**What it enforces: nothing.** It runs commands in a throwaway clone outside the repository and
prints a verdict. It does not merge, commit, tag, push or publish, and it changes no file of the
repository. A required status check on the release branch is what actually stops a red PR from
being merged; that is a repository setting, and the user's.

## Project profile

Read `.claude/ai-scrum.md`. Its `## Release` keys drive this command; a missing key takes the
fallback named here, and the report says which fallback was used.

- `release-branch` — the branch the PR targets and the release runs on. Missing: the branch the
  release workflow's `on.push.branches` names, else the remote's default branch
  (`git symbolic-ref --short refs/remotes/origin/HEAD`). `none`: there is no PR target and no
  release — the full check runs the PR lane on `HEAD` in a clean clone, and the verdict says so.
- `release-verify` — `auto` (also when missing): the method below. A command: the project's own
  check, run in place of steps F2–F4 (it must check the merge, every blocking step, under CI
  conditions — the project vouches for that, not this command). `none`: the short suites run on
  `HEAD` and the verdict is never `yes` (F6).
- `release-plan` — a read-only command that prints the next version and its bump level
  (`pwsh -File scripts/plan-release.ps1`, `node scripts/release.mjs --print-plan`). `none`: the
  verdict names no version, and the bump check is skipped with a note.
- `release-dry-run` — the release without commit, tag, push or publish
  (`pwsh -File scripts/ci-release.ps1 -DryRun`, `npx semantic-release --dry-run`). `none`: the
  release workflow's publishing step cannot be checked and is listed as not run.
- `changelog-path`, `changelog-style` (`unreleased` | `version-section`; missing: `unreleased`
  when the file has an `Unreleased` heading, else `version-section`) and `commit-style` (`plain`
  | `conventional`; missing: `plain`).
- `build`, `test`, `lint`, `typecheck` — the stand-ins when there is no CI configuration at all,
  and the short suites of `release-verify: none`. `e2e-cleanup` — run before a step that starts
  the app.

A `pwsh` in a profile command or a workflow step runs as `powershell -NoProfile
-ExecutionPolicy Bypass` where `pwsh` is not installed (a script that targets 5.1 runs the
same); the report names that substitution.

## Trail — what a watcher sees

A full run takes minutes in the background, so it says where it stands in `<trail>` =
`$(git rev-parse --git-common-dir)/ai-scrum/trail.md` — inside `.git`, never tracked, so a
line written after a sprint's last commit leaves the working tree clean. Two lines per full run,
appended by the shell with the timestamp it produces (`date '+%Y-%m-%d %H:%M'`), never typed;
`<sprint>` is the sprint id when `/sprint` runs this, `-` when you do:

- F4: `- <ts> · <sprint> · release-check · started · watch <work>/run.log`
- F6: `- <ts> · <sprint> · release-check · done · <the verdict line>`

`base` mode writes nothing there. The scrum cockpit reads exactly these lines; keep their shape.

## The verdict — one line, and how it is reached

The verdict is the first line of the report, in exactly one of three forms:

- `releasable: yes · merge of <sha> into origin/<release-branch>@<sha> · next release <version> (<level>) · <n>/<n> blocking steps green`
- `releasable: NO — <step>: <reason> · <what unblocks it>`
- `releasable: UNVERIFIED — <steps that did not run> · <why>`

**`yes` only when every blocking step ran on the merge and was green, and every check of B and
F5 passed.** NO beats UNVERIFIED, UNVERIFIED beats yes. Several NO reasons: the first in the
line, each further one on its own line below it (`also NO — …`), so one run names everything that
is red. A subset that was green is never `yes` — that is the exact failure this command exists to
end: build, test and typecheck green on the branch, `releasable: yes`, and the PR red on a step
nobody had run — and a workflow step the plan does not name (F3b) is a step that did not run.
`next release none` is a valid part of a `yes` (nothing is due); `<version>` is
`?` when there is no `release-plan`.

Under the verdict line, always: the warnings (W below), then the step table
`| # | Lane | Step | Command | Result | Min |` with every step of the plan, including the ones
that did not run and why. The table is the evidence; a verdict without it is not a report.

## B — Base (both modes, seconds)

1. **Fetch.** `git fetch --quiet --tags origin`. No remote, or the fetch fails: B2–B4 cannot be
   answered — `UNVERIFIED — release branch unknown: <error>`; in `base` mode say it in one line
   and stop. `release-branch: none`, or `HEAD` is the release branch itself: skip B2 and B3.
2. **What the release branch has that this branch lacks:**
   `git log --oneline --no-merges HEAD..origin/<release-branch>`. Every line is a reason for NO:
   the PR will be checked on a tree that contains it, and this branch has never been tested with
   it. The usual one is the release commit (`chore(release): 1.1.1`): it bumps the version and
   promotes the notes, so without it the branch still sees the shipped notes as unreleased and
   plans a version that is already tagged. Name every commit with sha and subject:
   `NO — missing release-branch commits: b492451 chore(release): 1.1.1 [skip ci] · merge origin/<release-branch> into <branch>`.
   This command never merges; `/sprint` does, under its own rule.
3. **Conflict.** `git merge-tree --write-tree --name-only origin/<release-branch> HEAD` (git ≥
   2.38). Exit 1 is a conflict: `NO — merge conflict with origin/<release-branch>: <files> · merge
   it and resolve them`, and nothing of F runs — there is no tree to check. Otherwise its first
   output line is the merged tree's id. On an older git, B3 happens in F2 by a real merge in the
   clone, and `base` mode reports the conflict question as unanswered.
4. **The release notes, on the merged tree** (`changelog-path: none` → skip and say so). Read the
   changelog from the merged tree without checking anything out:
   `git cat-file -p <tree>:<changelog-path>` (on an older git, from `HEAD`), and the release
   branch's copy with `git show origin/<release-branch>:<changelog-path>`.
   - **The open block** is where the next release's notes go. `unreleased`: the section under the
     `Unreleased` heading (`## Unreleased`, `## [Unreleased]`, `# Unreleased`). `version-section`:
     the topmost version section, but only if its heading is not on the release branch and no
     tag names its version; otherwise there is no open block yet, and the next note opens one.
   - **A published section is never changed.** A version section's reference is its text at
     its tag (`git show v<version>:<changelog-path>`, or `<version>` without the `v`) — that is
     what shipped — and, for a version without a tag, its text on the release branch. Compare
     each section of the merged tree with its reference, ignoring line endings:
     - equal → fine. That includes a branch that *restores* a section the release branch had
       damaged (notes moved back out of a shipped version into the open block).
     - different, and the merged tree's text is the release branch's → warning W4, not NO: the
       damage is already on the release branch, not this branch's doing —
       `notes: <heading> on origin/<release-branch> differs from its tag (<n> lines) — move them into the open block`.
     - different otherwise → `NO — notes: published section <heading> changed (<n> lines) · move those lines into the open block`
       — that is how six features of the next release end up listed under a version that never
       had them.
   - **Notes for a due release.** When a release is due (B5's level is not `none`; without a
     plan, when the branch carries user-facing stories, B6) and the open block is missing or
     holds nothing but comments and whitespace:
     `NO — notes: <the open block> in <changelog-path> is empty in the merge state · <where the notes are instead, if you can see them, else: write them there>`.
     A note that is an HTML comment placeholder is not a note.
5. **The plan.** `release-plan` reads history and tags, so it runs on the merge: in `base` mode on
   `HEAD` only if B2 found nothing (otherwise the plan is of a stale tree — say so instead of
   printing it); in full mode in the clone (F4). Its output gives the version and the level
   (`major` / `minor` / `patch` / `none`). A plan that refuses (a tag that already exists, an
   unknown state) is a NO with its message.
6. **The bump matches the content.** The expected level comes from every story the next release
   ships — finished since the last release tag, on either side of the merge: the files added
   under `<requirements>/done/` (`git diff --name-only --no-renames --diff-filter=A
   <last release tag>..<merge or HEAD> -- <requirements>/done/` — `--no-renames`, because
   `/build` moves the story there; without a tag, `origin/<release-branch>...HEAD`), each one's `Change type:` line in its `## Done` section
   (`/build` writes it): any `feat` → `minor`, else any `fix` / `perf` → `patch`, else `none`; a
   story whose change type is marked breaking (`feat!`) → `major`. Stories without the line
   (older ones) are left out and counted in the note. Compare with B5:
   - plan below expected (feature stories, patch planned) or a release planned where nothing
     user-facing changed: with `commit-style: conventional` it is
     `NO — bump: plan says <level> (<version>), the stories say <expected> · <the subjects that are wrong>`
     — the subjects are this workflow's, so a mismatch is its bug, and the commits get fixed;
   - with `commit-style: plain` it is warning W1 — the release script reads subjects this
     workflow does not type, so the fix lies outside the branch:
     `bump: plan says patch (1.1.2), the stories say minor — title the PR's merge commit "feat: …", or dispatch the release with the level`.
   - plan above expected is a warning only (a `feat` commit outside any story is legitimate).
7. **The last verdicts, against what happened.** A check nobody checks drifts unnoticed: if a
   `yes` is followed by a red PR, that has to surface by itself, not when someone happens to file
   it. Every full run leaves one line in `<records>` =
   `$(git rev-parse --git-common-dir)/ai-scrum/release-checks.jsonl` (F6) — inside `.git`, so
   per clone, never committed, never pushed. For each record without an `outcome`, oldest first,
   at most the last ten:
   - **Where the checked tree went.** In `git log --first-parent --format='%H %T %P'
     <record base>..origin/<release-branch>`, the oldest commit whose tree is the record's
     `merge_tree` (a merge or a squash on an unmoved base), else the oldest merge commit whose
     second parent's tree is the record's `head_tree` (the base moved — say so). That commit is
     the merge `M`; the PR head `P` is its second parent (a squash: the record's `head`). Nothing
     found → not merged yet: `P` is the record's `head`, there is no `M`, and only the PR lane
     can have an outcome. A record still unmerged when a newer record exists is closed as
     `superseded` with whatever PR outcome it has — the branch changed before the merge.
   - **What GitHub ran on it** — read-only: `gh api "repos/{owner}/{repo}/actions/runs?head_sha=<sha>"`,
     without `gh` the public API (`curl -s https://api.github.com/repos/<owner>/<repo>/actions/runs?head_sha=<sha>`),
     owner and repo from `git remote get-url origin`. PR lane: the `pull_request` runs on `P`;
     release lane: the `push` runs on `M`. A run still in progress, or no `M` yet → that lane is
     `pending`; the record closes once both lanes have an outcome (or it is superseded). A failed run's
     failing job and step from `…/actions/runs/<id>/jobs`, its first error line from
     `…/check-runs/<job id>/annotations`.
   - **The outcome**, written back into the record (rewrite that line) as one more field:
     `"outcome":{"result":"<result>","pr":"<lane>","release":"<lane>","checked_at":"<UTC ISO>"}`,
     each `<lane>` being `green`, `red: <workflow> › <job> › <step> · <run url>`, `pending` or
     `none`. Any lane red counts as red as soon as it is known — a red PR does not wait for a
     merge. `<result>` is one of `green`, `missed`, `not-confirmed`, `confirmed`, `superseded`,
     `pending` — from comparing with the verdict:
     - `yes` + green → a **green cycle**.
     - `yes` + red → **missed**, loudly, and the incident row for the problem record of the
       ai-scrum plugin (`docs/problems/release-readiness.md` in its repository), ready to paste:
       `| I? | <date> | <project> <run link> | <step>: <first error line> | releasable: yes · <sha> | ? | — |`.
     - `NO` / `UNVERIFIED` + green → **not confirmed**: GitHub passed what the check refused (a
       flaky test that held, a step that was stricter here). Counted, because a check that cries
       wolf gets ignored.
     - `NO` + red → confirmed.
   - **One line in the report:** `record: <n> green cycles in a row · <m> missed · <k> not
     confirmed (last ten) · <p> pending`, the missed ones each on their own line under it. The
     streak counts closed records newest first — `green` and `not-confirmed` (GitHub was green
     either way) add one, `missed` and `confirmed` (GitHub was red) end it, `pending` and
     `superseded` are skipped. The scrum cockpit counts the same way from the same file. Not
     GitHub, no API access, no records yet → `record: outcome unknown — <why>`; records stay
     open.
   This step never changes the verdict of the current run; it reports on earlier ones.

In `base` mode, B is the whole run. Report the verdict lines B produced (no step table — nothing
ran), or `base: clean · origin/<release-branch>@<sha> · next release <version> (<level>)`, then
B7's record line, and stop.

## F — Full

**F1 — The mode from the profile.**
- `release-verify: none` → run the short suites (`build`, `test`, `lint`, `typecheck`, each if
  set and not `none`) on `HEAD`, once, through ONE fresh `Agent` (`model: "sonnet"`,
  `run_in_background: false`) with `timeout: 600000` per call. They catch what a doc edit breaks,
  nothing more. A red one is NO. All green is still
  `releasable: UNVERIFIED — the PR and release lanes did not run on the merge (ran <commands> on HEAD) · set release-verify: auto in .claude/ai-scrum.md`.
  Then F5 and F6.
- `release-verify: <command>` → F2 for the clone, then the command in it as F4 would run one step
  (the condition prefix included); its exit code is the step result, its summary lines the
  evidence. Then F5 and F6, with `via <command>` in the verdict line.
- `auto` → F2 to F6 (F3b included).

**F2 — The merge, in a throwaway clone.** A work directory outside the repository:
`<work>` = `<system temp>/ai-scrum-release-check/<repo folder name>` — remove a leftover from an
earlier run first. Then:

```bash
merge=$(git commit-tree <tree from B3> -p origin/<release-branch> -p HEAD -m "release-check: merge simulation")
git clone --quiet --shared --no-checkout "$(git rev-parse --show-toplevel)" "<work>/tree"
cd "<work>/tree"
git checkout --quiet -B <release-branch> "$merge"
git update-ref refs/remotes/origin/<release-branch> "$merge"
git remote set-url --push origin "release-check://push-disabled"
git config user.name "release-check" && git config user.email "release-check@localhost"
```

The merge commit is an unreferenced object, garbage-collected later; no branch, ref, index or
config of the repository is touched. A clone, not a worktree: a worktree shares refs and config
with the repository, so a release dry run that tags or configures would write into the real one.
`origin/<release-branch>` points at the merge because that is what the release job sees after the
merge. A merge commit's subject differs from the PR's merge commit (`Merge pull request #n`); a
plan that reads only subjects since the last tag is unaffected, and one that reads the merge
subject is told so in the report. On an older git without B3's tree, merge for real inside the
clone (`git checkout -B <release-branch> origin/<release-branch>`, `git merge --no-edit <HEAD sha>`);
a conflict there is B3's NO.

**F3 — The step list, derived on every run, from the merged tree.** There is no stored list to
drift from the pipelines: the workflow files are read each time, from the clone, because those —
not the branch's — are what GitHub runs. Delegate to ONE fresh `Agent` (`model: "sonnet"`,
`run_in_background: false`) with this section, the profile's `## Release` and `## Verify` keys,
the paths `<work>` and `<work>/tree`, and the host OS. It reads, writes `<work>/plan.md` and
`<work>/run.sh`, runs nothing, and returns at most 25 lines: the plan table and the list of steps
it could not map.

- **The lanes.** GitHub Actions (`.github/workflows/*.yml`): the **PR lane** is every workflow
  with a `pull_request` (or `pull_request_target`) trigger whose `branches` filter is absent or
  matches the release branch; the **release lane** is every workflow with a `push` trigger on the
  release branch. Other CI systems (`.gitlab-ci.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`,
  `.circleci/config.yml`) the same way: the jobs a merge request runs, and the jobs a push to the
  release branch runs. No CI configuration at all: the lanes are the profile's `build`, `test`,
  `lint`, `typecheck`, and the verdict says `no CI configuration — profile suites`.
- **Per job:** `runs-on` (the OS), `if:` (a job that does not run for this event is not part of
  the lane), `continue-on-error: true` or a job the workflow marks as advisory → its steps are
  **advisory**: they run, and a red one is a warning, never NO. A job that is skipped when nothing
  is due (a release job behind a plan's `none`) follows the plan.
- **Per step, exactly one class:**
  - `run` — a `run:` command (or `script:`). It runs, in the step's `working-directory`, with the
    step's and job's `env:` minus every `secrets.*` value, and `${{ … }}` expressions resolved as
    the event would (`github.ref_name` → the release branch, empty `inputs.*`). `shell: pwsh` /
    `powershell` / `bash` / `cmd` decides the interpreter. **Blocking** unless advisory.
  - `install` — the dependency install (`npm ci`, `pnpm install --frozen-lockfile`,
    `dotnet restore`, `pip install -r …`, `bundle install`, `cargo fetch`, `go mod download`). It
    runs first, once for all lanes, and it is the **gate**: when it fails, every later step is
    `blocked by install`.
  - `environment` — what the clone and the condition prefix already provide: checkout, the
    language setup actions (`setup-node`, `setup-dotnet`, `setup-python`, …), caches, git identity.
    Not a step; but compare the runtime they pin (`node-version-file`, `global.json`,
    `.python-version`, `rust-toolchain`) with this machine's — a different major is warning W2.
  - `publish` — a step that needs a secret, pushes, tags, uploads to a registry or creates a
    release (`GH_TOKEN: ${{ secrets.… }}`, `git push`, `npm publish`, `gh release`, a release
    script). It is **replaced**: by `release-plan` (if set), then `release-dry-run`. Without a
    `release-dry-run` the step is `not run — needs <secret> / publishes; no release-dry-run in the profile`.
    When the plan says `none`, the dry run is `not due` and the release lane is the plan alone.
  - `artifact` — uploads and downloads of build artifacts, reports, coverage — no effect on the
    verdict; listed, not run.
  - `not local` — a blocking step this machine cannot run: a different OS where the command is not
    portable (a `.sh` with Linux tools on Windows, `apt-get`, a macOS signing step), a self-hosted
    runner's local paths, a service container, a secret the step needs for something other than
    publishing. Each is named with its reason, and each makes the verdict UNVERIFIED (unless
    something is NO). A portable command on a different `runs-on` (`npm test` on `ubuntu-latest`,
    run on Windows) is not `not local`: it runs, and the table notes the OS.
- **Every blocking step of both lanes appears in the plan** — as a step, merged into one (below),
  or with its class and reason. A step the agent cannot classify is `not local — unclassified:
  <the step>`, never dropped. That is the drift check: a step added to a workflow tomorrow shows up
  in tomorrow's plan.
- **`plan.md` is a table** `| # | Lane | Class | Kind | Label | Command | Source |`, one row per
  workflow step. `Source` is where the step is written, as `<workflow file name>:<line of its
  run:>` (`validate.yml:31`) — for a step that runs, one that was merged into another, and one
  that does not run alike. **Every `run:` line of every workflow that mentions `push` or
  `pull_request` gets a row**, also those outside both lanes (`excluded — schedule only`,
  `excluded — job skipped on push`): F3b checks exactly that, mechanically, so a row is never
  left out to save space.
- **Each distinct command runs once**, credited to every lane that contains it (`npm ci` in both
  lanes is one install, lane `pr+release`; `npm test` in both is one step). That is about the
  workflow's own commands: a release script that tests and packages inside its dry run is still
  one step of its own — what it runs internally is the release's, and it has to pass there too. Order: install, then the PR lane in
  workflow order, then the release lane: plan, dry run. A step whose input another step produces
  comes after it (a smoke of the packaged app after the package step).
- **`run.sh`**, bash (Git Bash on Windows), from this shape — the agent fills in the steps and the
  host-specific lines, nothing else:

```bash
#!/usr/bin/env bash
# release-check runner, generated for <merge sha>; throwaway.
W="<work>"; cd "$W/tree" || { echo "== fatal · no clone"; exit 90; }
export CI=true GITHUB_ACTIONS=true TZ=UTC GIT_TERMINAL_PROMPT=0
unset GH_TOKEN GITHUB_TOKEN NPM_TOKEN NODE_AUTH_TOKEN CSC_LINK CSC_KEY_PASSWORD WIN_CSC_LINK \
      WIN_CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD TWINE_USERNAME TWINE_PASSWORD \
      NUGET_API_KEY CARGO_REGISTRY_TOKEN VSCE_PAT OVSX_PAT DOCKER_PASSWORD
# Windows runner only (a job runs-on windows-*, and this host is Windows): TEMP as an 8.3 path.
mkdir -p "$W/runner-temp-folder"
T=$(powershell -NoProfile -Command "(New-Object -ComObject Scripting.FileSystemObject).GetFolder('$(cygpath -w "$W/runner-temp-folder")').ShortPath")
[ "$T" != "$(cygpath -w "$W/runner-temp-folder")" ] && export TEMP="$T" TMP="$T" || echo "== note · TEMP not emulated (no 8.3 names on this volume)"
GATE=""
step() { # step <n> <lane> <gate|blocking|advisory> <label> <command>
  local n=$1 lane=$2 kind=$3 label=$4 cmd=$5 t0=$SECONDS rc
  if [ -n "$GATE" ]; then echo "== result $n · $lane · $kind · $label · blocked by $GATE"; return; fi
  echo "== step $n · $lane · $kind · $label · $(date +%H:%M:%S)"
  ( eval "$cmd" ) > "$W/step-$n.log" 2>&1; rc=$?
  echo "== result $n · $lane · $kind · $label · exit=$rc · $(( (SECONDS - t0 + 30) / 60 )) min"
  [ $rc -ne 0 ] && tail -n 15 "$W/step-$n.log" | sed 's/^/   | /'
  [ $rc -ne 0 ] && [ "$kind" = gate ] && GATE="$label"
  return 0
}
step 1 setup gate "npm ci" 'npm ci'
# step 2 pr blocking "Typecheck" 'npm run typecheck'
# … one line per step, in plan order …
echo "== done"
```

  A step that needs a different environment variable (`CSC_IDENTITY_AUTO_DISCOVERY=false`, a
  `--publish never`) gets it inside its command string. The 8.3 lines are dropped when no job
  runs on Windows or the host is not Windows. Before an e2e or packaged-app step, the profile's
  `e2e-cleanup` is its own step (`advisory`).

**F3b — Is the plan complete? Checked by a script, not by the agent.** The plan is an agent's
reading of the workflows; a step it silently drops would be a step nobody runs, and the verdict
would still say `yes`. So before anything runs, you run this — seconds, no install — and read
its `==` lines:

```bash
cd "<work>/tree"
grep -oE '[A-Za-z0-9_.-]+\.ya?ml:[0-9]+' "<work>/plan.md" | sort -u > "<work>/plan-refs.txt"
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$f" ] && grep -qwE 'push|pull_request|pull_request_target' "$f" || continue
  grep -nE '^[[:space:]]*(-[[:space:]]+)?run:[[:space:]]*[^[:space:]]' "$f" | while IFS=: read -r ln cmd; do
    grep -qxF "$(basename "$f"):$ln" "<work>/plan-refs.txt" || echo "== coverage · missing · $(basename "$f"):$ln ·$cmd"
  done
done
echo "== coverage · checked $(ls .github/workflows/*.y*ml 2>/dev/null | wc -l) workflow files"
```

- No `missing` line → go on.
- `missing` lines → hand exactly those lines to the F3 agent once more (a fresh one, with the
  same brief plus the lines): it adds a row for each — a step, or its class and reason — and
  regenerates `run.sh`. Run the block again. Still missing → go on, and every line left is
  `not run — not in the plan` in the report: the verdict cannot be `yes` (UNVERIFIED, unless
  something is NO).
- CI that is not GitHub Actions has no mechanical check yet: say so as warning W5
  (`coverage: <ci system> not checked mechanically`).

**F4 — Run it, once, in the background.** It installs dependencies and runs whole pipelines; it is
long. From the top-level session, never from a subagent (a subagent cannot outlive a ten-minute
tool call and never hears when a background task ends):
1. A status line with its facts: `Release check · <n> steps (<pr> PR, <rel> release) · started
   <clock> · last took <minutes, or "first run, no estimate"> · watch <work>/run.log`. The clock
   is the output of the shell command that appends the `started` line to `<trail>` (`## Trail`),
   never typed.
2. ONE `Bash` call with `run_in_background: true`: `bash "<work>/run.sh" 2>&1 | tee "<work>/run.log"`.
3. End the turn with exactly that one task in flight and nothing else pending. Its exit
   notification wakes the session. Never poll, never sleep, never launch it a second time — a
   second instance collides with the first.
4. Read `grep '^== \|^   | ' "<work>/run.log"` — the step headers, results and the tails of red
   steps — never the whole log or a step log in full. A red step's full output is in
   `<work>/step-<n>.log` for whoever fixes it.

A red step is not re-run "to be sure". A test that failed may be re-run **alone, once** (only
those tests): green then is `flaky` — warning W3, and still NO when it sits in a blocking step,
because the PR runs it once too.

**F5 — B on the merged tree.** B4 (notes) and B6 (bump) with the plan's real output from the run.
B2's missing commits are still NO, even when everything ran green on the merge: the PR would be
green, but the branch itself has never had them, and every note written on it lands in the wrong
place.

**F6 — The report.** The verdict line (above), then:
- **W — warnings**, one line each: W1 bump (plain subjects), W2 runtime major differs
  (`node 22 here, .node-version says 20`), W3 flaky tests, advisory steps red, conditions that
  could not be emulated (TEMP, an OS), a dirty working tree (`git status --porcelain` not empty:
  the check ran on `HEAD`; commit exactly that, or the PR runs on a different tree), a `pwsh`
  substitution, W4 a published section already damaged on the release branch (B4), W5 a CI system F3b cannot
  check mechanically.
- The step table, in run order, every step of the plan.
- **Not run**, one line per `publish`-without-dry-run and `not local` step with its reason.
- B7's record line.
- **The record.** Append one line to `<records>` (B7; `mkdir -p` its folder) — after F2 only,
  so never for `release-verify: none` or a run that had no merge:
  `{"at":"<UTC ISO time>","sprint":"<SNN or null>","head":"<sha>","head_tree":"<tree>","base":"<origin/release-branch sha>","merge_tree":"<tree>","release_branch":"<name>","verdict":"yes|NO|UNVERIFIED","version":"<planned or null>","level":"<level or null>","steps":<blocking steps>,"red":["<step>",…],"not_run":["<step>",…]}`
  — written by the shell (`printf … >> <records>`), the time from `date -u`, never typed. It is
  what the next run's B7 compares with GitHub; it is inside `.git`, not a repository file.
- **The trail's `done` line** (`## Trail`), with the verdict line exactly as reported — also when
  the verdict is NO or UNVERIFIED, and also for `release-verify: none`, so a watcher never sees a
  check that started and never ended.
- Then clean up: `rm -rf "<work>"` — except when the caller still needs the step logs (`/sprint`
  phase 4 fixing a red step); then the caller deletes it once its verdict is final.

The verdict is reported, never committed: writing it into the repository would be a commit after
the check.

## Rules

- **Never merge, commit, tag, push or publish, never change a repository file.** Everything this
  command writes is under `<work>`, outside the repository, plus its record line, B7's outcomes
  and two trail lines in `.git/ai-scrum/` — inside `.git`, never tracked.
- **It checks itself twice:** F3b, before the run, that the plan names every workflow step; B7,
  on the next run, that its earlier verdicts matched what GitHub then did.
- **Each step once.** The only re-run is the isolated re-run of a failed test that tells red from
  flaky. After a fix, the whole command runs again — on the new `HEAD`, a new merge.
- **The verdict follows the rules above, not a judgment.** A red blocking step is NO however small
  it looks; a blocking step that did not run is UNVERIFIED however unlikely it is to fail.
- No polling loops, no watchdogs, no second background task: the one background run and its exit
  notification are the whole mechanism.

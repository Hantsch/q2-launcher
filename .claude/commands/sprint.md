---
description: Runs a sprint (sprints/SNN/sprint.md) autonomously — branch, the release branch merged in, refine + build every story with its acceptance tests, one commit per story, a full regression gate, the review doc, then the release check on the merge of the final commit.
argument-hint: <sprint-id>
model: sonnet
effort: medium
---

<!-- ai-scrum:managed 4.10.0 - plugin-owned, written by /ai-scrum:setup. Do not edit:
     setup diffs this file on update and asks before replacing it. Project facts go in .claude/ai-scrum.md. -->

Run sprint **$1**.

## Project profile

Read `.claude/ai-scrum.md` first — paths, verify commands, branching, auto-commit,
acceptance policy, `changelog-path`, the `## Release` keys (`release-branch`, `release-verify`,
`changelog-style`, `commit-style`) and doc language come from there. If it is missing, stop
and say: run `/ai-scrum:setup` first. Below, `<sprints>` and `<requirements>` mean the
corresponding paths from the profile.

## Core principle

You are the sprint orchestrator. The sprint runs **largely autonomously**: no stops for
small things, no question on every detail decision.

**Exception — deliberately open decisions belong to the user.** Whatever a story lists under
`## Open Questions` was left open on purpose — **never** decided by an agent. You (the
orchestrator) resolve those, bundled, via `AskUserQuestion` in the clarification round
(phase 1a) and in the follow-up after refine. Subagents cannot reach the user — that is why
every user question goes through you.

All **other** detail decisions are made by the agents themselves, **verified against the
spec** (story file, roadmap + the concept it links for the milestone, guardrails in
`CLAUDE.md`) and written down — in the story under `## Decisions (Sprint)` or in the Done
section. Only a real blocker that only the user can resolve, and that surfaces in the build
phase, stops the **affected story** (not the sprint) — it is marked as blocked and the rest
continues.

All state lives in files (`sprint.md`, story files, commits) — after a context reset
`/sprint $1` is **resumable** and continues at the first open spot.

## Status lines — what the user gets while the run is silent

The user sits in the chat and sees only your text. A foreground `Agent` call shows them
nothing until it returns, a story build is 10–60 minutes of exactly that, and a healthy run
looks the same as a dead one. So every step that can take longer than about three minutes is
framed by two lines of yours. They are part of this command, not chatter: an output style may
shorten their wording or change their language, never drop them.

- **Before the step**, one line of facts, not reassurance: what starts and how many are left,
  the clock, how long the last step of its kind took, the file to watch, and the escape —
  `Build 107 (2/4) · started 09:52 · 106 took 12 min · watch docs/sprints/S22/progress.md ·
  Esc + /sprint S22 resumes`. The clock is never typed: it is the output of the `Bash` call
  that appends the step's line to `<sprints>/$1/progress.md` in the same command, exactly like
  the trail rule in `build.md` — `- <shell timestamp> · 107 · build · started` for a story,
  `· refine · 106 107 108 109 · started` for the refine round, `· gate · e2e-all · started`
  for the long suite. **Phase 4 writes its lines elsewhere**: by then `progress.md` is
  committed in `<sprints>/done/$1/`, and a line appended after the review commit would leave the
  working tree dirty — the next `/sprint` refuses to start on it, or the line slips into someone
  else's commit. Its trail is `<trail>` = `$(git rev-parse --git-common-dir)/ai-scrum/trail.md`,
  inside `.git`, never tracked (`mkdir -p` its folder): `- <ts> · $1 · roadmap-check · started`,
  `- <ts> · $1 · roadmap-check · done`, and the release check's own two lines (its F4 and F6).
  Every phase-4 step writes both its `started` and its `done` line — that is how anyone watching
  (the scrum cockpit, you on resume) tells a running step from a finished one. The last duration comes from the trail (the previous story's `build ·
  started` and `story · done` lines) or from the previous sprint's `## Regression gate` record;
  for the first of a kind write `first one, no estimate` — never a guess.
- **After the step**, one line: result, elapsed, commit — `107 done · 16 min · 0a99dce · 2/4`.
- **The first line of the sprint** (phase 0) names the shape once: `Refine (parallel, ~10 min)
  → Build 4 stories (one after another, 10–20 min each, silent while they run) → Regression
  gate (long suite in the background, log named when it starts) → Review → Releasable
  (roadmap check, then the release check on the merge with main, in the background) ·
  next release from here: 1.4.0 (minor) · progress: docs/sprints/S22/progress.md`.

Nothing else goes between delegations — no summary of what an agent did, that costs context —
but these lines are not optional, and `Now building story 107.` does not satisfy them: no
clock, no estimate, no file.

**When the user asks whether it hangs** ("status?", "hängt das?", "machst du noch was?" — the
message reaches you when the current call returns), answer in at most five lines and start
nothing new in that turn:

1. the current step and its start time · elapsed of expected;
2. the last line of `<sprints>/$1/progress.md` with its timestamp (`tail -n 1`) — in phase 4
   the last line of `<trail>` — or for a gate suite the last three lines of its log;
3. background tasks alive (`<id> <command> since HH:MM`) or `none`;
4. what you are waiting for and when you expect it;
5. the escape: `Esc, then /sprint $1 — it resumes at the first open spot`.

"It is running, not hung" without those numbers is not an answer — a hung process also runs,
and the user asked because the numbers were missing. If the last trail or log line is older
than 15 minutes and you cannot name the reason, say that in those words; it is the user's cue
to intervene. A status question is never a reason to relaunch or re-verify anything. Derive
the state from `git status`, the trail and `sprint.md`, never from memory — an orchestrator
that "knew" its agent had stopped while it was still editing the tree has happened.

## Precondition

1. Open `<sprints>/$1/sprint.md`. If it does not exist, look in
   `<sprints>/done/$1/sprint.md` — a finished sprint lives there (phase 3 step 6), and step 2
   decides what happens to it. If neither exists: abort and point at
   `<sprints>/_TEMPLATE/sprint.md`.
2. Sprint status: `planned` → start normally. `in-progress` → **resume** (skip finished
   stories, continue at the first open spot). `done` → abort — unless every commit after
   the sprint's review commit on the work branch is one of phase 4's own (roadmap check, fix
   from the release check, merge of the release branch — `## Commit subjects`): then phase 4
   was interrupted or is asked again, and only phase 4 runs, from step 1.
3. `git status` must be clean. Foreign uncommitted changes → abort and ask the user.
4. **The work branch.** `sprint-branch: true` (also when the key is missing) → the sprint
   works on its own branch, named after `sprint-branch-pattern`, cut from `branch-base`.
   `sprint-branch: false` → the work branch **is** `branch-base`: no branch is cut and every
   commit of this command lands there. In that mode `branch-base` must not be listed in
   `protected-branches` — if it is, abort and say: either set `sprint-branch: true` or take
   the branch out of `protected-branches`. Below, "the work branch" means whichever applies.

## Commit subjects

Every commit this command makes has one of these subjects. `commit-style` in the profile picks
the column; missing means `plain`. `conventional` exists because a release script that derives
the bump from Conventional-Commit types reads `042: …` as a plain commit — patch — so a sprint of
features ships as a patch release, and a sprint of tests and docs cuts a release nobody wanted.

| Commit | `plain` | `conventional` |
| --- | --- | --- |
| sprint start (phase 0) | `$1: sprint started` | `docs($1): sprint started` |
| release branch merged in (phases 0, 4) | `$1: merge origin/<release-branch>` | `chore($1): merge origin/<release-branch>` |
| story done (phase 2) | `042: <message>` | `<change type>(042): <message>` |
| story blocked (phase 2) | `WIP 042: blocked — <reason>` | `chore(042): WIP blocked — <reason>` |
| gate fix (phase 2b) | `042: fix regression from sprint gate` | `<the story's change type>(042): fix regression from sprint gate` |
| review (phase 3) | `$1: sprint review + roadmap` | `docs($1): sprint review + roadmap` |
| roadmap check (phase 4) | `$1: roadmap check` | `docs($1): roadmap check` |
| release check fix (phase 4) | `$1: fix from release check` | `<type by what it changes>($1): fix from release check` |

The change type is the `Change type:` line `/build` writes into the story's `## Done` (`feat`,
`fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`; `feat!` for a breaking
change). Only `feat`, `fix` and `perf` release anything; a story that changes nothing for the
user is never typed `feat` or `fix`. When looking a commit up — resume, phase 4's own commits, the
bisect attribution — accept **both** columns and the older `$1: fix from release verification`,
because a project can switch style between sprints:
`git log -E --format=%h -1 --grep="^(docs\($1\)|$1): sprint started"`.

## Phase 0 — Setup

1. **Mark the sprint as running where everyone looks — on `branch-base`, before the branch
   exists.** With the sprint `planned`: check out `branch-base`, set `status: in-progress` and
   the `branch:` line in `sprint.md` (the work branch: the name the sprint branch is about to
   get, from `sprint-branch-pattern`, or `branch-base` itself with `sprint-branch: false`), and
   commit exactly that one file with the sprint-start subject (`## Commit subjects`). With a sprint branch this is the one
   commit this command makes outside it, and it is allowed even when `branch-base` is listed in
   `protected-branches`: it touches nothing but `sprint.md`, and it is what lets anyone on the
   base branch see that the sprint is under way and on which branch. Never push it.
2. **The sprint's base** is that start commit — `<sprint-base>` below, found again on resume
   with the lookup from `## Commit subjects`. Every "the sprint's commits"
   in this command is `<sprint-base>..HEAD`, in both modes.
3. With `sprint-branch: true`: create and check out the sprint branch from `branch-base`, named
   after `sprint-branch-pattern` (e.g. `sprint/$1`). On resume (`in-progress`) the start commit
   already exists and nothing is committed on `branch-base` again: check the branch out, or
   create it now if the run died between the two steps. With `sprint-branch: false`: stay on
   `branch-base` (on resume, check it out); there is nothing to cut.
4. **Bring the release branch in, before any story writes a line.** Read
   `.claude/commands/release-check.md` and run its part **B** (base: seconds, nothing installed,
   nothing run) yourself, on the work branch. A release on `release-branch` leaves a commit there
   that nothing brings back — the bot's version bump and promoted notes. A sprint that starts
   without it plans a version that is already tagged and files its notes under the version that
   is already shipped; measured: six stories' notes written into a released `## 1.1.0`, and
   `releasable: yes` twice on a branch whose PR then went red on exactly that.
   - **B2 found commits, B3 no conflict** → merge them into the work branch:
     `git merge --no-edit -m "<merge subject from ## Commit subjects>" origin/<release-branch>`.
     This is the one merge this command makes (see Rules): only from the release branch, only
     into the work branch (never into a `protected-branches` entry — with a sprint branch the
     merge rides into `branch-base` when the user merges the sprint), only without a conflict,
     never pushed. Say it in one line: `Merged origin/main into dev: b492451 chore(release): 1.1.1`.
   - **A conflict** → stop before phase 1; the sprint stays `in-progress`:
     `Stopped: origin/<release-branch> conflicts with <work branch> in <files> — merge it yourself
     and resolve them, then /sprint $1 resumes here.` A conflict is the user's to resolve.
   - **No remote, a failed fetch, `release-branch: none`** → one line saying so, and go on; phase
     4 reports what it could not check.
   - **B4 and B5 after the merge** go into the next step's first line: the planned next release,
     and a notes problem (the open block missing, a published section changed) as a warning — not
     a stop: the sprint's stories are what fill the open block. A published section that was
     *already* changed on the release branch is not this sprint's to repair; name it, leave it.
   - **B7's record line** too — how the earlier verdicts fared on GitHub. A **missed** one (the
     last sprint said `releasable: yes`, then a PR or release went red) is said loudly here, goes
     into this sprint's `review.md` under findings with its ready-made incident row, and into the
     final report. It does not stop the sprint: it is evidence that the check has a gap, and the
     gap is closed in the plugin, not here.
5. **Say what the run looks like from the outside** — the first-line status from
   `## Status lines`: the phases with their shape and rough length, the next release from step
   4, and the progress file `<sprints>/$1/progress.md`.

## Phase 1a — Clarification round (orchestrator ↔ user)

Before any refine agent starts:

1. From every story in the sprint list with status `draft`, read `## Open Questions`. Skip
   entries already marked as answered (resume). If any are open, say so in one line before
   asking — `3 open questions in 114, 116 block the start; the run continues once they are
   answered` — because a sprint started before leaving the desk waits here until someone comes
   back (measured: a sprint started at 17:14 asked at 17:27 and got its answers at 05:50 the
   next morning). Open questions are best resolved in planning, with `/refine`, before
   `/sprint` is called; this round exists for the ones that slipped through.
2. If open entries exist: put them to the user **bundled** via `AskUserQuestion` (max. 4
   questions per call, as many calls as needed). Per question: one sentence of story
   context, sensible answer options derived from spec/concept doc, one marked as
   recommended. Do NOT ask questions the story explicitly defers to refine, or pure
   balancing placeholders — those belong to the agents.
3. Write each answer into the affected story immediately: under `## Decisions (Sprint)` as
   `- **(User)** <short form of the question>: <decision>`, and mark the entry under
   `## Open Questions` as `~~…~~ answered → Decisions (Sprint)`.
4. Phase 1b starts only once every question asked has been answered and recorded.

## Phase 1b — Refine (all stories, in parallel)

For every story in the sprint list whose requirement is still `draft`, ONE fresh `Agent`
(`subagent_type: "general-purpose"`, **`model: "opus"`**, **`run_in_background: false`**) —
all calls in ONE message. Several foreground calls in one message run concurrently *and*
block until all of them have returned, which is exactly what this phase wants; backgrounding
them instead buys nothing and costs you the completion notifications. The status line before
it (`## Status lines`) counts the stories; exactly that many `Agent` calls follow **in this
same message**. One call per message is not parallel — measured: four refines one after
another, 20 minutes instead of seven. If you notice that the first refine has returned and the
others were never started, say so in one line and issue every remaining call in one message.
Prompt (self-contained, the agent does not know this session):

- Read the refine procedure — the file is
  `.claude/commands/refine.md` — and refine story **<id>** exactly along those
  steps, with the following **sprint deviations**:
  - **No questions to the user** (you cannot reach them). The deliberately open decisions
    are already answered under `## Decisions (Sprint)`, marked `(User)` — they are
    **binding** and are not re-decided or reinterpreted.
  - All **other** detail questions you decide yourself: against acceptance criteria, linked
    stories, the roadmap plus the concept linked for the milestone, and the guardrails in
    `CLAUDE.md` + the profile's context files. Document every decision with a one-sentence
    reason in the story under `## Decisions (Sprint)` (without the `(User)` marker).
  - **Triage "trivial":** do not wait for GO, do not implement anything directly — even
    trivial stories get a minimal plan + 1 deliverable and `status: ready`, so the build
    phase works uniformly.
  - **Tier budget, as in `refine.md`:** at most one `deliverable-hard` per story; the review
    line is `Review: → default` unless you can name the plausible wrong implementation that
    would pass the tests and a default review — then `Review: → story-review-hard`, which
    adds a second review pass, it does not replace the first. A story that seems to need two
    hard Ds is cut too big: put the split proposal into `## Open Questions`, leave `draft`
    and return `BLOCKED: user question`.
  - If you hit a **new** decision that belongs to the user (design direction, a
    contradiction in the spec, a missing factual basis): leave status `draft`, phrase the
    question precisely with answer options in `## Open Questions`, and return
    `BLOCKED: user question`.
- Return: `ready` or `BLOCKED: <reason>` + max. 5 lines of plan essence + the list of
  decisions taken + one line `tiers: D <n> / hard <h> · review default[+hard]`.

**Follow-up:** if a story came back with `BLOCKED: user question`, put the new questions to
the user (as in phase 1a), record the answers and start exactly ONE more refine round for
those stories. Stories still blocked afterwards are marked in their `sprint.md` line
(`(blocked: <reason>)`) — they are skipped in phase 2.

**Then one line of tiers**, from the refine returns, before the first build starts —
`Tiers: 114 D5/hard 1 · review default+hard — 115 D6/hard 1 · review default — …`. It is not
a question and needs no answer; it is the moment the user can still stop the run if the
budget looks wrong, and it is what the tier record in phase 3 is compared against.

## Phase 2 — Build (all stories, sequentially in list order)

For every `ready` story ONE fresh `Agent` (`subagent_type: "general-purpose"`,
**`model: "sonnet"`**, **`run_in_background: false`**) — strictly one after another (later
stories build on earlier ones). Both parameters are written out on purpose: an unset `model`
inherits the *session* model rather than this command's frontmatter and re-tiers the entire
agent tree below it, and an unset `run_in_background` means **background**, which for a
story-long build is a coin flip on whether you ever hear back. Do **not** escalate the tier
on your own — the hard tier is chosen per deliverable inside `/build`, from `## Model Hints`.
Before every build `Agent` call the status line with its `build · started` trail append, after
it returns the closing line, before the commit (`## Status lines`). Prompt (self-contained):

- Read the build procedure — the file is
  `.claude/commands/build.md` — and implement story **<id>** exactly along it:
  delegate deliverables one by one to fresh agents, honour `## Model Hints` (hard tier only
  where marked), verification with the commands from `.claude/ai-scrum.md`, clean-agent
  review over the diff, fill the Done section. **Sprint deviations:**
  - **No questions to the user.** Make decisions during implementation yourself, verify them
    against plan + acceptance criteria and document them in the Done section under
    "Decisions".
  - On a real blocker (plan has gaps, review-fix cycles exhausted, red tests you cannot
    fix): leave status `in-progress`, document the blocker honestly in the story file and
    return `BLOCKED: <reason>`. QA rules apply without exception — never weaken tests to go
    green.
  - Do not commit (the orchestrator does that).
  - **Narrow gate only.** Verify with step 5 of `build.md` as written — `test-story` /
    `e2e-story` where the profile sets them. Skip step 6b and the closing line of step 11:
    the full regression gate is the sprint's, and runs once after the last story.
  - **Progress file:** `<sprints>/$1/progress.md` (spell out the resolved path; the file is
    created by the first append). Apply the "Progress trail" rule from `build.md`'s
    `## Delegation rules` for every deliverable, the verification, each review cycle and the
    story's end (`<id> · story · done` as the last command before returning): one shell
    command per `started`/`done`/`blocked` event, the timestamp produced by the shell inside
    that same command, never typed. It costs almost nothing and it is the only thing that
    tells the user a long build is alive — they watch that file, where a running agent and a
    dead one look identical the moment the lines stop.
- Return: `done` or `BLOCKED: <reason>`, the commit message from the Done section, changed
  files, findings/decisions as bullet points, and the `tiers:` line from the Done section
  verbatim (`tiers: D <n> / hard <h> · review default[+hard] · cycles <c> · agents <a>`) —
  **at most 20 lines**, no diffs and no pasted file contents. Everything it returns stays in
  your context for the rest of the sprint.

**After each story YOU commit** — but only if `auto-commit-per-story: true` in the profile,
and only on the work branch (never push, never on a `protected-branches` entry). If it is
`false`, leave the changes staged-free and tell the user at the end which commits to make.

- Story `done`: tick the checkbox in `sprint.md`, then `git add -A` and commit with the
  prepared message, its subject per `## Commit subjects` (`042: finish team-based combat`, or
  `feat(042): finish team-based combat` with `commit-style: conventional` — the type is the
  story's `Change type:` line; a prepared prefix that disagrees with it is corrected to it).
- Either way, glance at the new lines in `<sprints>/$1/progress.md`: timestamps must be
  monotonic and none may be later than `date`/`Get-Date` says now. If they are not, the build
  agent typed them instead of running the trail command — note that under findings for
  `review.md` (phase 3) so it is visible, and do not repair the lines by hand.
- Story `BLOCKED`: commit the partial changes with the blocked subject (`## Commit subjects`) so they do
  not bleed into the next story's diff; mark the story in `sprint.md`. If a later story
  depends on the blocked one, skip it too (with a note) instead of building on a broken base.
- **Anything else is a failed agent, not a pause.** A return that is neither `done` nor
  `BLOCKED` — a status sentence ("waiting for D2", "sent a nudge to the D8 agent"), an API
  error, nothing at all — means the build stopped: it is a subagent, and whatever it said it
  was waiting for will never wake it. Do not `SendMessage` it and do not end your turn. Run
  `git status --short` and `tail -n 5` on the progress file, then dispatch ONE fresh foreground
  build `Agent` for the same story with the same prompt plus the note that partial edits may
  already exist. A second such return is `BLOCKED`. A rate-limit message instead (`429`,
  "session limit", a reset time) ends the run: print the reset time and the resume instruction
  (`/sprint $1` after it), commit nothing, stop.

## Phase 2b — Regression gate (mandatory, after the last story, before the review)

Every story passed its own narrow gate; this is where they run **together**. A story's gate
proves its criteria and what its changes touch — it cannot see a later story breaking an
earlier one's flow, or two stories that are each fine and wrong in combination. Running all
suites once, on the finished work branch, is what catches that. This phase is not optional and is
not skipped because every story came back green: that is exactly the state in which such a
regression hides.

Resume: the result lives in `sprint.md` under `## Regression gate` and is committed with the
review in phase 3. If that section already holds a result and no story or fix commit came
after the commit it names, skip to phase 3.

**Budget — launches, and it is small.** The full suites run once (steps 1 and 1b) —
**once**, the long suite included: there is no confirmation run of `e2e-all` after a fix. The
attribution agent re-runs only the failing tests, at most twice (once on `HEAD`, once at
`<sprint-base>`). A fix agent re-runs the failing tests, the short suites and the story-sized e2e
gate on its own fix once per attempt — two attempts — and that narrow run *is* the
confirmation. Measured over six sprints before this rule: the second full run after the fixes
was ~45 % of all gate flow time and never once caught a regression a fix had introduced; the
one sprint that skipped it lost nothing. One extra launch is allowed for a
run the environment lost — an empty log, `another instance is already running`, a port in
use, a crash before the first test — after the leftover check in step 1b; a second loss of
that kind is reported as the environment's state, not launched a third time. That is every
launch this phase has: at most three full-suite launches, usually one per suite. A collision with a stale process
is not a test result. And once the attribution agent has returned its verdicts, the gate is
**decided**: no baseline run in a worktree, no "one clean, isolated run", no re-run "to be
sure", no second attribution — go to step 5 with what you have. Measured without this
paragraph: nine launches of the same 15-minute suite, and a gate phase longer than all four
story builds together.

1. **Run the short suites** — ONE fresh `Agent` (`model: "sonnet"`, `run_in_background: false`),
   so the suite output lands in its context and not in yours. It runs, each once, on the
   work branch's `HEAD`: `build`, the full `test`, the full `e2e` — each only if set and not
   `none` — **but not `e2e-all`**, which is step 1b and yours. Quote it the ceiling rule from
   `build.md`'s `## Delegation rules` ("A `Bash` call ends after ten minutes …") word for
   word: `timeout: 600000` on every suite call, and a command that is moved to the background
   anyway is stopped with `TaskStop` at once and reported as `exceeded`, never awaited. It
   changes no files and returns at most 15 lines: per command green / red / exceeded with its
   minutes, and for red the failing test names with their files. Nothing to run at all (every
   entry `none`) → record that and go on.
1b. **Run the long suite yourself, in the background, once.** `e2e-all` (if set, not `none`,
   and not the same command as `e2e`) — and any command step 1 returned as `exceeded` — runs
   from your session, never from a subagent: a subagent cannot outlive a ten-minute tool call
   and is never told when a background task ends; this session is. In this order:
   - **Leftovers first.** If the suite drives a single-instance app or a server on a fixed
     port (Electron, a dev server), look once for instances a previous run left behind and stop
     them — a stale one makes every flow fail with `another instance is already running`, which
     is a collision, not a red test. Run the profile's `e2e-cleanup` if it is set.
   - **The status line** (`## Status lines`), its trail append `- <ts> · gate · e2e-all ·
     started` and `watch: <sprints>/$1/gate-e2e-all.log`. The last duration comes from the
     previous sprint's `## Regression gate` record; without one, `first run — a full flow suite
     is usually 10–20 min`.
   - **ONE `Bash` call with `run_in_background: true`**, the output through `tee` into that
     log — `<e2e-all> 2>&1 | tee <sprints>/$1/gate-e2e-all.log` — never a bare `>`: a suite
     that buffers or dies leaves an empty file, and an empty log is a result nobody can
     attribute (measured: eleven minutes for nothing). Never as a foreground `Bash` either:
     that only burns ten minutes before landing in the same background state.
   - **End the turn** with exactly that one task in flight and nothing else pending. This is
     the one sanctioned kind of wait in this command (see Rules): the task's exit notification wakes
     this session. When it arrives, read only the runner's summary — `tail -n 40` of the log —
     never the whole file; the attribution agent gets the log path.
2. **Green**, or red only in quarantined tests (step 3) → record it (step 5), go to phase 3.
3. **Red → attribute it to a story.** Delegate to ONE fresh `Agent` (`model: "sonnet"`,
   `run_in_background: false`) with the failing tests, the gate log's path, the sprint's story
   commits (`git log --oneline <sprint-base>..HEAD`), the `build` command, the ceiling rule from
   `build.md` and the instruction to change no source file and to run only the failing tests,
   never a whole suite — if the failing subset alone would exceed ten minutes, it says so and
   returns `unattributed` for those tests instead of running them. Its verdict is final for
   this sprint: you do not launch a suite to check a subagent's result.
   - **Flaky first:** run only the failing tests once more on `HEAD`. Green now → not a
     regression but a flaky test; it is named as a finding in the review, never silenced, and
     not bisected.
   - **Pre-existing:** run only the failing tests on the sprint's start
     (`<sprint-base>`). Red there too → the sprint did not cause it; it is
     reported as pre-existing, not bisected, not fixed here.
   - **Otherwise bisect** over the sprint's commits: `git bisect start HEAD <sprint-base>`, then
     `git bisect run` with a script that runs `build` (when set) and only the failing tests —
     never the whole suite per step. The first bad commit names the story by its ID
     (`042: …`, `WIP 042: …`, `feat(042): …`, `chore(042): WIP …` — `## Commit subjects`). Always finish with `git bisect reset`, and
     confirm the branch is back on its `HEAD` with a clean tree.
   - Returns at most 10 lines: per failing test the verdict (`flaky` / `pre-existing` /
     `story <id>, commit <sha>`), and for `flaky` / `pre-existing` the cause in one line.
   Without per-story commits (`auto-commit-per-story: false`) there is nothing to bisect: the
   agent attributes by which story's changed files the failing test exercises, and says that
   the attribution is a judgment, not a bisect result.
   **`flaky` and `pre-existing` are quarantined, not just reported.** Each such test gets an
   entry in the list at the profile's `e2e-quarantine` — `{ flow, reason, story, since: $1 }`,
   `flow` being the test or flow name and the reason the agent's one-line cause — and one
   follow-up line in phase 3's roadmap update. A quarantined test that fails again is an
   expected failure: it does not turn the gate red and is not attributed again; one that
   passes is reported as an unexpected pass. Still quarantined two sprints later, it is a story at the next
   `/roadmap plan`, not a follow-up. With `e2e-quarantine: none` the follow-up line is all
   there is, and the review says the project has no quarantine yet. Measured without this:
   four flows red for five sprints, re-attributed at ~10 minutes per gate.
4. **Fix it on the work branch, or report it as a blocker.** Per attributed story, ONE fresh
   `Agent` (`model: "sonnet"`, `run_in_background: false`) gets the story file, the failing
   tests, the bisected commit's diff and the build rules that still hold: fix the cause, never
   the test — a test weakened until the gate goes green is the regression shipped. **Its
   re-run is the confirmation; the long suite does not run again.** Once per attempt, on the
   still uncommitted fix, it re-runs: the failing tests (the way the attribution agent ran
   them), the short suites, and — when the profile sets `e2e-story` — that template filled
   with the failing e2e tests' files (and `{shard}` per `e2e-story-slices`, as in `build.md`
   step 5), so a changed-files selection also covers whatever the fix diff touches. The
   ceiling rule from `build.md` applies to it like to any subagent. A full `e2e-all` after
   the fix is not launched, not even "to be sure": the fix was checked where it can break
   something, and the next full run is the next sprint's gate or the release.
   Green → commit on the work branch with the gate-fix subject from `## Commit subjects` (only
   with `auto-commit-per-story: true`, same rules as phase 2), and append one line to that story's `## Done` naming the regression and the fix
   commit. Two fix attempts without green → stop fixing: it is a **blocker for the merge**,
   reported in the review with the failing tests and the attributed story. The story file is
   not moved back out of `done/`; the blocker is the sprint's, not a reopened story.
5. **Record** under `## Regression gate` in `sprint.md` (append the section if missing): the
   commands that ran with their measured minutes (the next sprint's status lines quote them),
   green/red, the commit it ran on, and per failure its verdict and outcome (fixed in `<sha>` /
   blocker / pre-existing / flaky / `unattributed — budget exhausted after <n> launches`;
   `unattributed` counts as a merge blocker), the quarantine entries written and any
   unexpected pass. This is the resume marker, and the source for the review. Recording the
   gate closes it: before writing this section, `TaskStop` every gate
   launch that is still running — a result that arrives after the record cannot change it, and
   its notification after the final report would restart the sprint (`## Closing the run`) —
   and delete `<sprints>/$1/gate-*.log`; the record is what survives.

## Phase 3 — Sprint review

1. **`<sprints>/$1/review.md`** you write yourself from the collected results (in the
   profile's `doc-language`). It moves to `<sprints>/done/$1/` in step 6, so write every
   relative link in it for that final location, one folder deeper:
   - **Overview:** sprint goal + table (story · status · short commit description).
   - **Implemented stories:** 1–3 lines each on what was built.
   - **Findings & decisions:** aggregated from the `## Decisions (Sprint)` sections, the
     build feedback and the review findings — input for the next sprint planning
     (corrections, direction decisions). Every review finding left deliberately unfixed
     leaves the review in this step: as a story draft (`<requirements>/_TEMPLATE.md`,
     `status: draft`) or, if small and decision-free, as a follow-up line for step 3. This
     section links to them and keeps no list of its own. Measured without it: ~15 and ~25
     unfixed findings in two sprints' reviews, none of which ever left them.
   - **Blocked / open:** blocked stories with their reason and the question the user has to
     decide.
   - **Regression gate:** from `## Regression gate` in `sprint.md` — the commands, the
     result, and per failure the test, the story it was bisected to and what happened (fixed
     in which commit, blocker, pre-existing, flaky). A regression that is still red is listed
     under **Blocked / open** as well, and the review says plainly: do not merge (with
     `sprint-branch: false`: do not push or release) before it is resolved.
   - **Acceptance:** one section listing, per story, the criteria and the test that proved
     each one (from the Done sections) — and separately every `manual residue` with its
     reason. That list is the sprint's acceptance record. It is also the honest place to say
     that a criterion was covered a level below the real surface because the `e2e` harness
     does not exist yet.
   - **Tier record:** one table from the `tiers:` lines the build agents returned — story ·
     Ds · hard Ds · review stages · review cycles · agents dispatched · build minutes (from the
     trail) — plus a totals row and one sentence: did the second-stage (hard) review find
     anything the default review had missed? That table is the sprint's cost signal: the hard
     tier is the bulk of the bill, and the next planning reads this table to decide whether the
     budget in `refine.md` holds or needs tightening. A hard review that found nothing new
     three sprints in a row is the cue to drop it to a final confirmation only.
2. **`<sprints>/$1/testplan.md`** — governed by `testplan` in the profile, and **it is not an
   acceptance gate**; the tests are. Default `optional`:
   - **`optional`:** collect every `manual residue` line from the sprint's stories. If there
     are none, **write no file** and say so in the review — nothing here needs a human. If
     there are some, write only those: per residue the reason it cannot be automated, the
     preparation, the steps and the expected result. Nothing else goes in — a criterion with
     a passing test is not walked again by hand.
   - **`required`:** delegate to ONE fresh `Agent` (`model: "sonnet"`,
     `run_in_background: false`) to write the full step-by-step plan for the sprint's use
     cases: read the story files (`## Acceptance Criteria`, `## Acceptance Tests`, legacy
     `## Test Plan (manual acceptance)`) and the surface actually built, in the code. Per use
     case **preparation** (how to start the app per the README, test content), **steps**
     (where to click, what to type), **expected result**. Only use cases from stories actually
     implemented in this sprint, no invented features.
   - **`off`:** skip the file entirely.
3. **Update the roadmap** (`roadmap-path`) — it is a one-screen map, and this step touches
   exactly three places in it, never more:
   - **The milestone's table row:** sprint link (to `review.md` at its final path,
     `<sprints>/done/$1/review.md`), status from the real state —
     all its stories done means **`done <date>`**, not "built, acceptance pending"; there is no
     user acceptance step gating this, the criteria were proven by their tests, and what a
     later walk-through finds becomes a new story in a new sprint. The row's note is at most
     one sentence (a blocked story, a deliberate omission) or empty. Gaps, manual residue and
     criteria covered below the real surface stay in `review.md` — the roadmap **never** gets a
     "Gaps/notes" paragraph.
   - **"Follow-ups worth doing":** one line per finding that is worth doing, needs no decision
     and is not a story yet, with `[SNN review](…/review.md)` as its source. Remove lines this
     sprint has made obsolete. Anything bigger is a story draft (step 1), not a roadmap line.
   - **"Where we stand"** and "As of": rewrite the block (max. five lines) — what was just
     finished, what is next, what is waiting on the user (the merge).
   If every milestone of a concept's phase is thereby `done`: `git mv` the concept to
   `systems-path` and update its status line.
4. **If `changelog-path` is set in the profile:** check that every story done in this sprint
   whose `Change type:` is `feat`, `fix` or `perf` has its entry there, **in the open block** —
   where the release reads its notes, decided by `changelog-style` exactly as `build.md` step 9b
   says (`unreleased`: under the `Unreleased` heading; `version-section`: the topmost section
   that is not on the release branch yet). `/build` writes them per story; this is the sweep
   that catches the ones it missed and the ones it put in the wrong place. A missing entry is a
   finding in the review, not something you fix silently — add it, and say in the review that
   it was added late. **A published section is never changed:** if
   `git diff <sprint-base>..HEAD -- <changelog-path>` touches a version section that exists on
   `origin/<release-branch>`, move those lines into the open block, restore the section to its
   text at its tag (on the release branch, without a tag), and name it as a finding. When `changelog-path` is `none`, skip this.
5. `sprint.md`: `status: done` as soon as every story is `done` or visibly marked blocked,
   and the regression gate (phase 2b) is recorded — green, or its red result named as a
   blocker in the review.
   Nothing is held open for an acceptance round — a sprint is finished when its work is
   finished, and a story stays open only for a blocker that makes it genuinely
   uncompletable (normally caught in refinement, not here).
6. **Archive the sprint, then the final commit.** `git add -A`, then
   `git mv <sprints>/$1 <sprints>/done/$1` — the whole folder (`sprint.md`, `progress.md`,
   `review.md`, `testplan.md`), so the open sprints folder only ever shows what is still
   running. Then the commit, with the review subject from `## Commit subjects`
   (`$1: sprint review + roadmap`) — it carries the move, the
   `## Regression gate` record in `sprint.md` and the `e2e-quarantine` file the gate edited, if
   any, too (add `+ testplan` only if a `testplan.md` was actually written). Move and commit
   happen together, in this order, in one step: the review commit is the one phase 4 checks, so
   the move must be in it, never after it. Everything after this step that names the sprint's
   folder means `<sprints>/done/$1/`.

## Phase 4 — Releasable (after the review commit, last)

The sprint ends releasable: the commit the user merges, opens a PR from or releases is the one
the last check ran on. The gate ran before phase 3, and phase 3 edits files after it — a roadmap
line, a moved story, a debt row. In a project whose tests read those files, an unchecked review
commit is how a green gate turns into a red PR (measured: a green 93-minute gate phase, then one
roadmap line added by the review commit failed the PR's unit tests). So this phase runs last, and
**nothing of the sprint is committed after its green run.**

1. **Roadmap check.** Status line and the `roadmap-check · started` line in `<trail>`
   (`## Status lines`), its `done` line when the agent has returned. ONE fresh
   `Agent` (`model: "sonnet"`, `run_in_background: false`) reads `.claude/commands/roadmap.md`
   and runs its mode `check` on the work branch, plus what the profile's `## Notes` add to that
   mode. It cannot ask the user: a step that needs them (an older-shape rebuild, a decision) is
   reported, not done. It commits nothing and returns its report in at most 15 lines. If it
   changed files, commit them with the roadmap-check subject (`## Commit subjects`). Its report
   goes into the final report.
2. **The release branch, once more.** Part B of `.claude/commands/release-check.md` again: if
   `origin/<release-branch>` moved during the sprint (a release, a hotfix), merge it in exactly
   as phase 0 step 4 does — before the check, so nothing is committed after it. A conflict is
   the verdict `NO — merge conflict with origin/<release-branch>: <files> · merge it and resolve
   them, then /sprint $1`, and steps 3–4 do not run.
3. **The release check, on the merge, once.** Run `.claude/commands/release-check.md` in full
   mode — read it and follow it; you are the top-level session it needs for its one background
   run. It is what GitHub will run: the merge of `HEAD` into `origin/<release-branch>`, in a
   throwaway clone with a clean install, every blocking step of the PR lane and the release lane
   (the release as a dry run), under CI conditions — derived from the workflow files on every
   run, so it cannot drift from them. Run it with `$1` as its sprint id — its trail lines in
   `<trail>` and its record carry it. Its F4 is this phase's background task: the status line
   with the `release-check · started` line, ONE background `Bash`, end the turn, read its
   summary when it returns; its F6 writes the `done` line with the verdict. `release-verify` in the profile picks the method
   (`auto`, the project's own command, or `none` — which can never be `yes`).
   A NO for a reason outside the code — a prerequisite that is not running, a step that needs
   the user (a secret, a tag that already exists), the bump with `commit-style: plain` — is not
   fixed by you. It is the verdict of step 5, with the action that unblocks it; after that
   action, `/sprint $1` runs this phase again.
4. **Red → fix, at most twice.** For a red step in the code — a test, a format check, the
   package, notes the sprint filed in the wrong place, subjects whose type contradicts the
   stories — ONE fresh `Agent` (`model: "sonnet"`, `run_in_background: false`) per failing step,
   with the failing output, `<work>/step-<n>.log` and the build rules that still hold: fix the
   cause, never the test. It re-runs the failing step's own check (the failing tests, the format
   check, …) once per attempt in the work tree; green → commit with the release-check-fix subject
   (`## Commit subjects`), then step 3 again — the whole check, on the new `HEAD`. A wrong subject
   is fixed by the next commit's type only when that is honest; rewriting pushed history is never
   an option, and rewriting the sprint's local commits is the user's call — report it instead.
   Two rounds without green → stop: the sprint is **not releasable**, a blocker naming the
   failing step.
5. **The verdict is reported, never committed.** Writing it into `review.md`, `sprint.md` or
   anywhere else in the repository would be the unchecked commit this phase exists to prevent.
   It is the release check's verdict line, unchanged — `releasable: yes · merge of <sha> into
   origin/<branch>@<sha> · next release <version> (<level>) · <n>/<n> blocking steps green`,
   `releasable: NO — <step>: <reason> · <what unblocks it>` or `releasable: UNVERIFIED — <steps
   not run> · <why>` — followed by its warnings and its step table. Never `yes` from a subset:
   the short suites green on `HEAD` are not a release check (measured: two sprints in a row said
   `releasable: yes` on build + test + typecheck, and both PRs went red on steps nobody had run).
   The check's own record line in `.git/ai-scrum/release-checks.jsonl` (its F6, with `"sprint":
   "$1"`) is not a repository file and not a commit; the next sprint's phase 0 compares it with
   what GitHub did. Then delete the release check's `<work>` directory.

## Closing the run — before the final report

1. **Nothing of yours is still running.** Every `Agent` call you issued has returned — a
   result reading `[Request interrupted by user for tool use]` is a *detached* agent, not a
   stopped one: it may still be editing the tree and will hand back later; say so, and never
   start a second build agent for the same story on top of it. Every background task you
   started has returned or been stopped with `TaskStop`. `<sprints>/done/$1/gate-*.log` and the
   release check's `<work>` directory are deleted.
2. **Nothing is pending.** The gate is recorded, `review.md` and the roadmap are committed with
   the sprint folder moved to `<sprints>/done/$1/`, and
   phase 4 has its verdict on the current `HEAD`. If one of them is not, you are not at the
   final report yet.
3. **The final report is written once, and it ends the run.** Whatever arrives afterwards — a
   task notification for a launch you forgot to stop, a late agent result, a stray Monitor
   event — gets exactly one line (`Late result of <task>: <one-line outcome> — the sprint is
   reported, nothing changes`) plus a `TaskStop` if the task is still alive, and no other tool
   call: no run, no fix, no attribution, no worktree, no "one clean run to be sure". The single
   exception is a late result that contradicts the recorded gate verdict (a suite recorded
   green now red, or the reverse): one line saying exactly that, then `AskUserQuestion` whether
   to reopen the gate — reopening is the user's decision. After "done" the user wants to know
   one thing: whether they can walk away. Twenty silent minutes of re-runs after the final
   report is what they experience as a hang.

## Final report to the user

The first line is phase 4's verdict — `releasable: yes · …` with the planned version and level,
or `releasable: NO — …` / `releasable: UNVERIFIED — …` with what unblocks it, loudly, because it
decides whether the user can open a PR. Directly under it its warnings and its step table, the
PR lane and the release lane step by step, and the record line (green cycles, missed, not
confirmed — a missed one loudly). Then, short and complete: the work branch, stories done/blocked, the roadmap check's report
compacted, path to `review.md` (and to
`testplan.md`, if one was written — otherwise say plainly that nothing needs walking by hand),
the regression gate in one line (green, or which story broke what and whether it was fixed — a
red gate first and loudly, because it decides the merge), the acceptance record in one line
(criteria proven by tests / manual residues / criteria covered below the real surface), one
line of measured minutes (refine, each story, each gate command — from the trail and the gate
record; the next sprint's estimates come from there), one line of tiers (the totals row of the
tier record: `tiers: D 22 / hard 3 · hard reviews 1 of 4 · agents 41`), that nothing is still running
(`background tasks: none`, or the list and why), and that merging into `branch-base` is the
user's decision — with `sprint-branch: false` instead that the commits are already on
`branch-base` and pushing them is the user's decision. A `protected-branches` entry is never
the target of a sprint branch merge you make.

## Rules

- **Never push. Never commit on a protected branch. No merge** — that is the user's job. Two
  exceptions, both narrow. The sprint-start commit of phase 0 on `branch-base`: one file, once,
  never pushed. And `origin/<release-branch>` merged into the work branch (phase 0 step 4, phase
  4 step 2): only that source, only into the work branch, only without a conflict, never pushed
  — it is mechanical, and a sprint without it builds on a tree the PR will never see. Merging
  the sprint into `branch-base`, the PR and the release stay the user's. `sprint-branch: false`
  changes where the commits land, never this rule: its `branch-base` is not protected, or the
  run does not start.
- **Acceptance is the test suite.** A sprint does not hand the user a list of things to click.
  Every criterion was mapped to a test in refine and proven by it in build; `review.md` records
  which test proved what. A sprint that ends with "please walk these 40 items" has failed at
  refine, not at review.
- **Narrow per story, broad per sprint.** Each story runs only its own tests and flows; the full
  suites run once, in phase 2b, on the finished branch. Never skip that phase to save time and
  never widen a story's gate to compensate — the one is cheap because the other exists.
- **The real surface (P1)**, if `ui-acceptance-required: true`: criteria about user actions are
  proven through the profile's `e2e` command. Where a story could only cover one a level below
  that — a missing harness, a missing trigger — it is named as a gap in `review.md` (and, if
  closing it is worth doing, as one follow-up line in the roadmap), never quietly converted
  into a manual step.
- **Manual residue is the exception and it is bounded.** Only criteria that cannot be automated
  for a real reason (an OS dialog, specific hardware, a paid external service) land on a human,
  each with that reason. They are listed in the review and, per the `testplan` setting, in
  `testplan.md`. They do not hold a story or the sprint open.
- Auto-commits apply only to `/sprint` on the work branch; elsewhere "never
  commit without being asked" still holds.
- **Never end a turn waiting for an agent.** A turn without a tool call ends your run — "I'll
  report back once the build agent returns" is not a pause, it is the end of the sprint, and
  the user finds out by noticing that the working tree stopped moving. Every `Agent` call is
  foreground, and the question never comes up. The **one** exception is the background `Bash`
  task of phase 2b step 1b (and, the same way, the release check's run in phase 4 step 3 — one
  at a time, never both), started by you at the top level: a background task's exit
  notification does reach this session — it never reaches a subagent, which is why the gate
  agent must not start one. End that turn only after the status line, with exactly that one
  task in flight and nothing else pending — not with an agent, not with two tasks, not "to see
  how it goes".
- **There is no watchdog you can build, so do not build one.** `ScheduleWakeup` belongs to
  `/loop`; outside it the call schedules nothing and answers "no pending wakeup to cancel" — a
  sprint that calls it has armed nothing. `TaskOutput` cannot resolve a subagent id, a
  standalone `sleep` is refused, a `Monitor` dies with the turn that started it, and a dummy
  "noop" agent wakes you with the wrong result. Foreground delegation plus the one background
  task above is the whole mechanism; polling loops (`until … sleep`), heartbeat agents and
  `echo waiting` turns are not substitutes and must not be improvised — measured: a polling
  loop against a wrong path ran orphaned for two hours and forty minutes.
- **Do not switch the session model while a sprint runs**, and say so to the user if they ask
  mid-run. Every agent started without an explicit `model` inherits the session model and
  passes it down its whole subtree — flipping to Opus mid-sprint therefore re-tiers everything
  that follows, at roughly five times the price, with no visible change in behaviour.
- Context discipline: keep agent returns short; read story files only where needed — the
  state lives in `sprint.md` + story status, not in your memory. You are the orchestrator:
  reading source files yourself is an agent's job, and whatever you read is re-read on every
  turn you have left.
- If ALL stories are blocked or phase 0 fails: stop cleanly and report the state honestly.
- **Older story files** may use the previous German headings (`## Offene Fragen`,
  `## Entscheidungen (Sprint)`, `## Akzeptanzkriterien`, `## Modell-Hinweise`) — treat them
  as equivalent and keep each file's existing language.

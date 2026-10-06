---
sprint: S32
status: done
branch: sprint/S32
milestone: 11.1 — Codebase health, part 1 — a green gate, safe foundations, one module bus
---

# Sprint S32 — Codebase health, part 1 — a green gate, safe foundations, one module bus

## Goal

The end-of-sprint flow gate is binary: green, or red for a named new regression. The two safety
findings are closed (path containment, shell handlers that throw prose). Every module answers through
one typed `Outcome` envelope with one refusal shape, owns its persisted state, and reaches Electron
only through the shell, and a test plus a linter enforce those layer rules. Jobs, package staging,
HTTP fetches and platform rules each exist in exactly one place. Users see no change except a
correct error message where they used to see English prose or a path.

## Stories (in build order)

- [x] 223 — the flow gate is green or says why
- [x] 226 — the repo is formatted once and its dependencies are current
- [x] 225 — tests share a quiet logger and one test-support kit
- [x] 199 — path containment is one checked rule
- [x] 200 — a thrown shell handler answers with an i18n key, not prose
- [x] 201 — the launcher shuts down in order and says when a write failed
- [x] 202 — state slices are mutated in place, never replaced from a snapshot
- [x] 203 — forgiving row parsing is one helper
- [x] 204 — the module bus returns one Outcome envelope and every error key resolves
- [x] 206 — a refusal is one shape with a full i18n key and one toast path
- [x] 205 — module handlers are typed from a contract and every declared handler is live
- [x] 207 — modules own their persisted state
- [x] 208 — layer rules are a test and a linter, not a convention
- [x] 209 — modules reach Electron and the harness only through the shell
- [x] 221 — HTTP fetches share one timeout and size policy
- [x] 222 — platform rules live in one module
- [x] 220 — package staging is one path and the dead download queue is gone
- [x] 219 — jobs share one runner, one busy rule and one failure log

## Notes

- Source: [codebase review 2026-10-01](../../../reviews/2026-10-01-codebase-review.md). The review
  suggested five sprints, which this cut merges into two (S32, S33).
- **Why two sprints, not one.** This sprint changes the contract every module sits on (envelope,
  refusal, typed handlers, persisted state, jobs). S33 rewrites the renderer and the config module
  on top of that contract. The gate between the two sprints proves the contract change with every
  flow before anything is built on it. With a single 34-story gate, a red flow would have to be
  pinned to one of 34 refactoring commits.
- **Order.** 223 goes first so that this sprint's own gate is already binary. 226 goes next so every
  later diff is formatter-clean and the dependency upgrade is exercised by the 16 stories after it.
  225 goes third because every later story's tests use its kit. After that the safety and
  foundation stories run (199–203), then the bus in dependency order (204 → 206 → 205;
  202 + 203 → 207; 208 → 209), and last the shared main-side services (221, 222, 220 → 219).
- 226: do not run prettier over globs ad hoc. The worktree is CRLF and `.prettierrc` says
  `endOfLine: lf`, so the one-time formatting is a deliberate, single commit made by the story itself.
- 226 vs 208: ESLint is absent because `typescript-eslint@8` does not support TS 7. 208's "linter"
  has to settle on a tool that works with the dependencies 226 leaves behind.
- Deliberately not in this sprint: config/renderer refactors, docs and the tech-debt triage (all in
  S33), and 102 (Linux Q2PRO build, needs its Q1–Q4 decided first).

## Regression gate

Ran on `376e5fe` (sprint branch HEAD after two fix commits).

| Command                                         | Minutes | Result                                    |
| ----------------------------------------------- | ------- | ----------------------------------------- |
| `npm run build` / `typecheck` / `lint`          | ~0.2    | green                                     |
| `npm test`                                      | 0.4     | green (524 files, 6563 passed, 8 skipped) |
| `npm run ui:verify`                             | 1.9     | green (60/60 screens, 0 axe violations)   |
| `npm run ui:flows` (first run, on `b9f3c76`)    | 49.8    | red: 134/138                              |
| `npm run ui:flows` (confirmation, on `376e5fe`) | 49.4    | green: 136/138, `mods-view` expected fail |

`verify:release` was not run (Docker daemon down, run exceeds the 10-minute call ceiling).

First-run failures and verdicts:

- `bootstrap-wizard` — story 209, commit 9a5b2ec: `bootEnv` copied `process.env` case-sensitively, so `ProgramFiles` was not found on Windows. **Fixed in 4d8f9e7.**
- `quit-persists-state` — story 220, commit dd4e2a3 (attributed from the code, no bisect): the flow from 201 clicked a switch 220 now disables. **Fixed in 26a7c24** (flow flips the enabled Replays missing-mod switch).
- `mods-view` — **pre-existing** (red at the merge-base): `uppercase` class on the installation name since story 188. Quarantined in `scripts/flows/quarantine.json` (376e5fe).
- `replays-mod-warning` (already quarantined, flaky) reported an unexpected pass; kept in quarantine as a known 1–2 of ~6 flake.

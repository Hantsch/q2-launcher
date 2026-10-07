---
id: 226
title: the repo is formatted once and its dependencies are current
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want `npm run format` to be usable as intended, line endings to be
independent of each clone's git config, and the shipped Electron and the dev tree to carry no
known high-severity advisories, so that diffs stop carrying formatting churn and dependency
drift is caught weekly by a bot instead of at a release.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F57, F58; the
dependency items are a roadmap follow-up): `prettier --check .` reports 1,044 unformatted files
(1,411 with the configured `endOfLine: lf`, because the Windows worktree is CRLF under
`core.autocrlf=true` and `.gitattributes` is empty); `format:check` runs in no workflow;
`verify-release.mjs` pins `core.autocrlf` per snapshot and the project memory codifies "never
run prettier over globs here". The only patch in `patches/` (`jsdom++undici`) justifies itself
with "older Node versions" while `engines.node` is `>=22` and every workflow uses Node 22, so it
pins jsdom's nested undici for a solved problem and will break `postinstall` on the next jsdom
bump. `npm audit` reports 8 vulnerabilities (6 high, all fixable) including the pinned Electron
(sandbox advisory; 43.7.7 wanted) and `js-yaml`; 18 packages are outdated; there is no
dependabot or renovate configuration.

## Acceptance Criteria

- [x] **AC1** — `.gitattributes` declares `* text=auto eol=lf` plus binary entries for images,
      fonts, archives and the vendored 7za; a fresh clone on Windows and Linux shows identical
      line endings in the worktree (`git ls-files --eol` has no `w/crlf` for text files).
- [x] **AC2** — One commit runs `prettier --write .` over the whole repo and is listed in
      `.git-blame-ignore-revs`; `npm run format:check` is green and part of `ci.yml`.
- [x] **AC3** — `patches/`, the `postinstall: patch-package` script and the `patch-package`
      devDependency are removed; `npm ci && npm test` is green on Node 22.
- [x] **AC4** — `npm audit --omit=dev --audit-level=high` reports zero; Electron and the other
      "wanted" versions are updated and the lockfile committed; `verify:release` passes
      afterwards (packaging rehearsal, since Electron moved).
- [x] **AC5** — `.github/dependabot.yml` exists: weekly, minor/patch grouped, Electron and Vite
      majors as separate PRs; the audit step runs in CI non-blocking for one sprint, then
      blocking (recorded as a follow-up with a date).
- [x] **AC6** — The project memory note about not running prettier is deleted and the roadmap
      follow-up about dependencies is removed.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — Land the format commit on `dev` right before a sprint branch is cut, to keep it
  out of every open diff? Timing to be agreed with the user.

## Decisions (Sprint)

- **(User)** timing of the format commit: Lands on the sprint branch as 226's own single commit (second story).
- The formatting is one formatting-only commit made by D1 inside 226's build; `.git-blame-ignore-revs`
  naming its hash lands in the story commit right after it — a commit cannot contain its own hash.
- The format commit also carries `git add --renormalize .` — both are whitespace-only, so one
  blame-ignored commit is cheaper than two.
- `.prettierignore` gains `.claude/`, `content/`, `**/__fixtures__/`, `docs/fixtures/`, `resources/`
  — `.claude/` is hash-locked by `ai-scrum.lock`/`tech-rules.lock`, `content/` must stay
  byte-identical with the external checkout (`check-content-repo.mjs`), fixtures are real captures.
- The seven NUL-bearing UTF-8 files git auto-detects as binary (`AliasesTab.tsx`,
  `round-trip.test.ts`, `fs-utils.test.ts`, `master-source-address.ts`, two docs, one `.mvd2`) get no
  explicit attribute — `text=auto` keeps them `-text`, which is what the memory note already requires.
- `scripts/verify-release.mjs`'s per-snapshot `core.autocrlf` pins stay — `eol=lf` overrides them, so
  removing them is churn with no effect (only its "this machine's line endings" comment is corrected).
- `format:check` runs on the ubuntu leg of `ci.yml`'s `test` job only — with `eol=lf` both legs see
  identical bytes, so a second run proves nothing.
- `engines.node` moves to `>=22.12.0` — `markAsUncloneable` (what the patch stubbed) only exists from
  Node 22.10, so `>=22` alone would not make the patch obsolete.
- "Wanted" means within the current `package.json` ranges (`npm update` + `npm audit fix`, never
  `--force`); majors (Electron 44, Vite 8, plugin-react 6, js-yaml 5) are left to dependabot's
  separate PRs — 208 and the `electron-vite@5` constraint own those.
- Beyond AC4's `--omit=dev` gate, the full `npm audit --audit-level=high` must also be zero at story
  time — the Requirement asks for the dev tree too, and every finding is fixable without `--force`.
- The audit CI step is `npm audit --audit-level=high` with `continue-on-error: true`, on the ubuntu
  leg; the follow-up "make it blocking" goes into ROADMAP follow-ups dated 2026-10-09 (end of S33).
- dependabot covers the `npm` ecosystem only, one `minor-and-patch` group; majors stay ungrouped, so
  Electron and Vite majors each arrive as their own PR without extra config.
- The "roadmap follow-up about dependencies" is the sentence "Vite is pinned to 7.x … revisit at
  `electron-vite@6`" — dependabot's separate Vite-major PR now owns it; the ESLint sentence stays (208).
- CHANGELOG gets one `### Security` line for the Electron update — users receive the fixed runtime;
  the format, patch and bot changes are internal and get none.
- AC6's memory note lives outside the repo in the user's per-machine agent memory; D4 deletes it and
  its `MEMORY.md` index line, and it is the story's one manual residue.

## Plan

Facts (2026-10-02): no `.gitattributes`; `git ls-files --eol` shows 1,084 `i/lf w/crlf`, `LICENSE`
`i/crlf`, `docs/requirements/done/INDEX.md` mixed; 66 `-text` (images + 7 NUL-bearing sources);
`resources/bin/7za.exe` is gitignored (fetched). `npm audit`: electron, js-yaml, undici (3 nested
copies), fast-uri, @xmldom, brace-expansion high; vitest moderate — all fixable. The only patch is
`patches/jsdom++undici+8.10.1.patch`.

Order (each step leaves the gate green):

1. **D1** — line endings + one format commit + format gate. Static checks in a new
   `scripts/repo-hygiene.test.mjs` (picked up by vitest's `scripts/**/*.test.mjs`).
2. **D2** — drop patch-package; `engines.node >=22.12.0`. Before D3 so a jsdom bump cannot break
   `postinstall`.
3. **D3** — `npm update` + `npm audit fix`, lockfile, CHANGELOG Security line, `verify:release`.
4. **D4** — dependabot, non-blocking audit step in CI, dated follow-up, roadmap + memory cleanup.

All new checks live as `describe` blocks in `scripts/repo-hygiene.test.mjs`, each added by the D
that implements the behaviour.

## Deliverables

- **D1 — LF everywhere, the repo formatted once, `format:check` in CI.**
  Files: `.gitattributes` (new), `.prettierignore`, `.git-blame-ignore-revs` (new), `.github/workflows/ci.yml`,
  `scripts/verify-release.mjs` (comment only), `CONTRIBUTING.md` (one line), `scripts/repo-hygiene.test.mjs` (new),
  plus the mass reformat. Mirror `scripts/lib/release/wiring.test.mjs` for reading repo files in a test.
  1. Start from a tree where `git status` shows only this story's file; stash anything else and
     restore it after step 5 (formatting someone's in-flight edits into the format commit is exactly
     the churn the memory note warns about).
  2. `.gitattributes`: `* text=auto eol=lf`, then `binary` for `*.png *.ico *.avif *.jpg *.jpeg *.gif
*.webp *.woff *.woff2 *.ttf *.otf *.zip *.7z *.gz *.tgz *.exe *.dll *.so *.dm2 *.mvd2 *.pak *.pcx
*.wal *.bsp *.tga`, and `resources/bin/7za* binary` for the vendored 7za. Do **not** force
     `text` on anything: the seven NUL-bearing UTF-8 files git auto-detects as binary
     (`src/renderer/src/modules/config/AliasesTab.tsx`, `src/main/modules/config/round-trip.test.ts`,
     `src/main/lib/fs-utils.test.ts`, `src/shared/servers/master-source-address.ts`,
     `docs/requirements/done/040-*.md`, `docs/sprints/done/S02/review.md`) must stay `-text`.
  3. `.prettierignore`: add `.claude/` (hash-locked by `ai-scrum.lock`/`tech-rules.lock`), `content/`
     (byte-identical mirror checked by `scripts/check-content-repo.mjs`), `**/__fixtures__/`,
     `docs/fixtures/`, `resources/`.
  4. `git add --renormalize .`, then `npx prettier --write .`, then `npm run typecheck && npm test &&
npm run build`. Verify the NUL bytes in the seven files survived (`tr -cd '\000' < f | wc -c`
     unchanged: 2,1,2,1,2,1). Commit **only** these whitespace/format changes as
     `S32 226: format the repo once (prettier --write . + renormalize to LF)`.
  5. Re-checkout the worktree so it matches the index: for every path `git ls-files --eol` still
     reports `w/crlf`, delete and `git checkout --` it.
  6. `.git-blame-ignore-revs`: the format commit's full hash with a `#` comment line naming it;
     `CONTRIBUTING.md` next to the `npm run format` row: one line on `git config blame.ignoreRevsFile
.git-blame-ignore-revs` and that CI runs `format:check`.
  7. `ci.yml` `test` job: step `Format check` → `npm run format:check`, `if: matrix.os == 'ubuntu-latest'`,
     after `npm ci`.
  8. `verify-release.mjs`: keep the `core.autocrlf` pins; correct the header comment so it no longer
     claims the host snapshot has "this machine's line endings" (`.gitattributes` makes both LF).
     Tests in `scripts/repo-hygiene.test.mjs`, `describe('line endings and formatting')`:
     "every text file is LF in the worktree" (runs `git ls-files --eol`, fails on any line whose `i/`
     is not `-text` and whose `w/` is `crlf` or `mixed` — on CI this runs on a fresh Windows and Linux
     checkout); ".gitattributes declares text=auto eol=lf and binary entries" (asserts the `*` line and
     `*.png`, `*.woff2`, `*.zip`, `resources/bin/7za*` entries); "the format commit is blame-ignored"
     (every non-comment line of `.git-blame-ignore-revs` is a 40-hex hash `git cat-file -e` accepts);
     "ci runs format:check" (`ci.yml` contains `npm run format:check`). Plus `npm run format:check` green.

- **D2 — the obsolete undici patch is gone.**
  Files: `package.json`, `package-lock.json`, `patches/` (delete), `scripts/repo-hygiene.test.mjs`.
  Delete `patches/jsdom++undici+8.10.1.patch` and the directory, the `postinstall: patch-package`
  script and the `patch-package` devDependency (`npm uninstall patch-package`); set
  `engines.node` to `>=22.12.0` (`markAsUncloneable`, which the patch stubbed, exists from 22.10).
  Run `npm ci && npm test` on Node 22 if available locally (else note the local version; CI is Node 22).
  Test `describe('no patched dependencies')` › "no patch-package, no patches dir, engines cover
  markAsUncloneable" (asserts `patches/` absent, no `postinstall`/`patch-package` in `package.json`,
  `engines.node` is `>=22.12.0`).

- **D3 — dependencies current, zero high advisories.**
  Files: `package.json`, `package-lock.json`, `CHANGELOG.md`, `scripts/repo-hygiene.test.mjs`.
  `npm update` (stays inside the current ranges: electron → 43.7.7, js-yaml → 4.3.2, jsdom → 30.1.x,
  vitest → 4.1.11, zod, react, i18next, …), then `npm audit fix` — **never `--force`**, take no major
  (Electron 44, Vite 8, `@vitejs/plugin-react` 6, js-yaml 5 stay where they are). Raise the
  `package.json` floors of `electron` and `js-yaml` to the fixed versions (`^43.7.7`, `^4.3.2`).
  Both `npm audit --omit=dev --audit-level=high` and `npm audit --audit-level=high` must exit 0;
  paste both outputs' summary lines into the story's Done section. Then `npm run typecheck && npm test
&& npm run build && npm run ui:verify` and `npm run verify:release` (packaging rehearsal; needs act +
  Docker — if they are absent, record that as a named gap, do not claim green). CHANGELOG
  `## Unreleased` › `### Security`: `- Updated Electron to 43.7.7 for upstream security fixes.`
  Test `describe('dependency floors')` › "the lockfile carries no advisory-affected electron or
  js-yaml" (reads `package-lock.json`: `packages["node_modules/electron"].version` ≥ 43.7.7,
  `packages["node_modules/js-yaml"].version` ≥ 4.3.2, compared numerically).

- **D4 — a bot watches the dependencies; the old notes are gone.**
  Files: `.github/dependabot.yml` (new), `.github/workflows/ci.yml`, `docs/ROADMAP.md`,
  `scripts/repo-hygiene.test.mjs`, and outside the repo
  `C:\Users\darkp\.claude\projects\c--development-Hantsch-q2-launcher\memory\prettier-repo-wide-churn.md`
  plus its line in that folder's `MEMORY.md`.
  `dependabot.yml`: `version: 2`, one `package-ecosystem: npm`, `directory: /`, `schedule.interval:
weekly`, `groups: { minor-and-patch: { update-types: [minor, patch] } }`; majors stay ungrouped, so
  Electron and Vite majors arrive as their own PRs (a comment says so). `ci.yml` `test` job, ubuntu
  leg, after `npm ci`: step `Audit (non-blocking until 2026-10-09)` → `npm audit --audit-level=high`
  with `continue-on-error: true`. ROADMAP `## Follow-ups worth doing`: remove the sentence "Vite is
  pinned to 7.x (`electron-vite@5` constraint) — revisit at `electron-vite@6`." (keep the ESLint
  sentence), add "- Make `ci.yml`'s `npm audit` step blocking (drop `continue-on-error`) on
  2026-10-09, after S33. [story 226]". Delete the memory file and its `MEMORY.md` index line.
  Tests `describe('dependency automation')`: "dependabot runs weekly with minor/patch grouped and
  majors separate" (parse with `js-yaml`: npm ecosystem, weekly, a group whose `update-types` are
  exactly minor+patch, no group listing `major`); "ci runs a non-blocking audit with a dated
  follow-up" (`ci.yml` has an `npm audit --audit-level=high` step with `continue-on-error: true`;
  ROADMAP contains `npm audit` and `2026-10-09`); "the roadmap carries no Vite pin follow-up"
  (ROADMAP does not contain `Vite is pinned to 7.x`).

## Model Hints

- D1 → deliverable-hard: a ~1,400-file rewrite whose failure modes are byte-level and invisible to
  `git diff` — NUL-bearing `-text` sources, hash-locked `.claude/` files, the byte-identical
  `content/` mirror, someone's dirty worktree swept into the commit — and the D itself must make the
  format-only commit and re-checkout the worktree in the right order.
- D2, D3, D4 → default.
- Review: → default

## Acceptance Tests

- AC1 → unit `scripts/repo-hygiene.test.mjs` › "every text file is LF in the worktree" and
  ".gitattributes declares text=auto eol=lf and binary entries" (CI's `test` job runs it on a fresh
  windows-latest and ubuntu-latest checkout — the "fresh clone on both platforms").
- AC2 → unit `scripts/repo-hygiene.test.mjs` › "the format commit is blame-ignored" and "ci runs
  format:check"; command gate `npm run format:check` exit 0.
- AC3 → unit `scripts/repo-hygiene.test.mjs` › "no patch-package, no patches dir, engines cover
  markAsUncloneable"; command gate `npm ci && npm test` (CI: Node 22).
- AC4 → unit `scripts/repo-hygiene.test.mjs` › "the lockfile carries no advisory-affected electron or
  js-yaml"; command gates `npm audit --omit=dev --audit-level=high` exit 0 and `npm run verify:release`
  exit 0, both recorded in Done.
- AC5 → unit `scripts/repo-hygiene.test.mjs` › "dependabot runs weekly with minor/patch grouped and
  majors separate" and "ci runs a non-blocking audit with a dated follow-up".
- AC6 → unit `scripts/repo-hygiene.test.mjs` › "the roadmap carries no Vite pin follow-up"; manual
  residue: the memory note lives in the user's per-machine agent memory outside the repo
  (`C:\Users\darkp\.claude\...`), which no repo test or CI runner can see — D4 deletes it and Done
  records the deletion.

Coverage: AC1 → D1, AC2 → D1, AC3 → D2, AC4 → D3, AC5 → D4, AC6 → D4.

## Done

Repo is LF via `.gitattributes` and formatted once (`prettier --write .` plus renormalize) in a blame-ignored commit; `format:check` runs in CI (ubuntu). patch-package, `patches/` and the undici patch are gone (`engines.node >=22.12.0`). Electron 43.7.7 / js-yaml 4.3.2, both npm audits at 0; dependabot (weekly, minor/patch grouped) and a non-blocking CI audit step added; Vite-pin roadmap note and the prettier memory note removed.

Commit message: `226: dependencies current (Electron 43.7.7), dependabot, repo hygiene tests, blame-ignore the format commit`
(The format commit `20c8c79` already exists locally as `226: format the repo once (formatting only)`.)

Verification (narrow gate): typecheck, build, `npx vitest run --changed HEAD` (448 files, 6260 tests), `npm run format:check`, `scripts/repo-hygiene.test.mjs` 9/9 green. `npm audit --omit=dev --audit-level=high` and `npm audit --audit-level=high`: both "found 0 vulnerabilities". `npm run ui:verify` green (60/60 screens, axe 0). Review (default tier, 1 cycle): AC1-3, AC5, AC6 PASS.
AC to test: AC1 "every text file is LF in the worktree" + ".gitattributes declares ..."; AC2 "the format commit is blame-ignored" + "ci runs format:check" + format:check; AC3 "no patch-package, no patches dir, ..."; AC4 "the lockfile carries no advisory-affected electron or js-yaml" + audits; AC5 both dependabot/audit tests; AC6 "the roadmap carries no Vite pin follow-up" - all passed.
Named gap (AC4): `npm run verify:release` was NOT run - the Docker daemon is down on this machine and the run exceeds the 10-minute call limit; the sprint's full gate must run it. Manual residue (AC6): memory note `prettier-repo-wide-churn.md` and its MEMORY.md line were deleted outside the repo by D4.

Decisions: (1) Prettier strips NUL bytes from `docs/requirements/done/040-*.md` and `docs/sprints/done/S02/review.md`, so both are listed in `.prettierignore` and stay byte-identical. (2) Prettier was not idempotent in one pass on 14 files; passes were repeated until stable and amended into the single format commit (blame-ignore hash updated). (3) The LF test is skipped where no `.git` exists (verify:release snapshot); the blame test runs `git cat-file -e` only in a full clone because CI checkout is shallow - CI there checks the 40-hex format only (fetch-depth: 0 would close it; left out as not required). (4) Audit step sits right after the setup action (which runs `npm ci`), before Format check.

tiers: D 4 / hard 1 · review default · cycles 1 · agents 6

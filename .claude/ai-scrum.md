# AI Scrum — Project Profile

<!--
  Written by `/ai-scrum:setup` (ai-scrum plugin). Safe to edit by hand — setup only
  rewrites values you confirm, and never touches your `## Notes`.

  This file holds FACTS the workflow commands need verbatim (verify commands, paths,
  branch strategy). Project RULES and architecture guardrails stay in CLAUDE.md —
  the commands read both.

  The workflow itself lives in this repository: `.claude/commands/{refine,build,sprint,
  roadmap,concept}.md` plus `.claude/agents/{deliverable-hard,story-review-hard}.md`.
  Everyone who clones the repo can use it; the plugin is only needed to install or
  update those files (`/ai-scrum:setup`). Hashes of the managed copies: .claude/ai-scrum.lock
-->

ai-scrum-version: 2.1.0
project: Q2 Launcher

## Verify

Commands the build step runs before a story may be called done. Use `none` when a
step does not exist in this project.

build: npm run build
test: npm test
lint: none
typecheck: npm run typecheck

## Conventions

doc-language: en <!-- language for generated artifacts: stories, sprint reviews, concepts -->
requirements-path: docs/requirements
sprints-path: docs/sprints
roadmap-path: docs/ROADMAP.md
concepts-path: docs/concepts
systems-path: docs/systems
story-id-format: NNN <!-- three digits + slug, e.g. 042-npc-haggling.md -->
sprint-id-format: SNN <!-- e.g. S07 -->

## Branching

branch-base: dev <!-- branch a sprint is cut from -->
sprint-branch-pattern: sprint/{id}
auto-commit-per-story: true <!-- /sprint commits once per story ON THE SPRINT BRANCH only -->
protected-branches: main, dev <!-- never commit here, never push, never merge -->

## Acceptance

ui-acceptance-required: true
<!--
  true  = P1 applies: every user-facing capability needs a real path through the
          actual UI. An acceptance or test-plan step for a user action that requires
          a console command or a direct internal call is a story gap, not a valid
          test. Pure engine/backend stories without a UI are exempt.
-->

live-smoke-required: true
<!--
  true  = P2 applies: for a story with visible UI, a green build/test run is not
          enough — the real flow must be driven through the running app before the
          story may be set to done. If the session cannot do that, the story stays
          in-progress and is handed over as "built, acceptance pending".
-->

live-smoke-how: npm run ui:verify — builds if needed, seeds the fixture, screenshots every screen and runs an accessibility report against the real app; see docs/UI-VERIFICATION.md.

## Context to read before coding

Files every implementation and review agent must read before touching code.
Keep this short — it is pasted into every subagent prompt.

- CLAUDE.md
- docs/ARCHITECTURE.md

## Notes

<!-- Free text. Never overwritten by setup/update. Project quirks worth knowing. -->

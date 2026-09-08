# Sprint S16 Review — From nothing to a playable Q2PRO demo installation

## Overview

Goal: a user with no Quake II installed opens a wizard from the Library, picks Q2PRO, and gets a
working, playable demo installation — engine and free game data downloaded from a curated
manifest, verified, extracted, and assembled automatically. This is the first slice of the
[Install concept](../../concepts/install-module.md).

| Story | Status | Commit |
| --- | --- | --- |
| 070 — The launcher reads a curated manifest instead of hardcoded download URLs | done | `070: fetch, validate and cache the install manifest` |
| 071 — A download is a verified job, never a trusted file | done | `071: downloads are verified jobs — fetch, extract, queue` |
| 072 — Settings learn to host a module's own section, starting with Downloads | done | `072: settings gain a downloads section` |
| 073 — The Downloads tab shows what is running, what failed, and what is cached | done | `073: the Downloads tab shows jobs and failures` |
| 074 — The Library turns nothing into a playable Q2PRO demo installation | done | `074: bootstrap wizard turns nothing into a playable Q2PRO demo install` |
| 032 — Downloads icon shows a running-count badge | done | `032: downloads icon shows a running-count badge` |

All six stories done, none blocked. Sprint goal reached: the free-download, Q2PRO-only bootstrap
wizard is real and its acceptance criteria are proven by automated tests, end to end.

## Implemented stories

- **070** — Main-process pipeline that fetches, validates (zod, envelope-refuses/package-drops),
  and caches the curated manifest from `Hantsch/q2_community_content`, with real, live-verified
  content for the Q2PRO nightly mirror and both free game-data packages.
- **071** — The `downloads` module's verified-download core: streamed fetch with mirror fallback
  on size/hash mismatch, a vendored `7za.exe` extractor invoked with a fixed argv, and a
  module-owned concurrency queue producing real `Job`s through the existing `JobsService`.
- **072** — `RendererModule` gained an optional `settingsSection`; the downloads module is the
  first to use it (concurrency limit, cache budget, download-while-playing), plus archive-cache
  eviction (oldest-first, in-use/`.part` protected).
- **073** — The `downloads` module's real view: running/queued jobs, a persistent i18n'd failure
  log with a 7-day dismissed history, and the cache size figure shared with Settings.
- **074** — The sprint's payoff: a four-step wizard from the Library wires manifest + download
  pipeline + Downloads tab into one flow that downloads, verifies, extracts and assembles a
  `baseq2` installation, registers it through the existing `InstallationsService`, and marks it
  "Demo" wherever the installation is shown.
- **032** — A running-count badge on the titlebar's Downloads button, bound to the renderer's
  existing job store, generic across any module (not hardcoded to `downloads`).

## Findings & decisions

- **Manifest pinning strategy (070, User decision):** the Q2PRO nightly asset is mirrored into
  our own `Hantsch/q2_community_content` release rather than pinned against the upstream rolling
  tag, so a hash pinned today cannot silently start failing when upstream republishes. Publishing
  that mirror is the one manual step this sprint could not complete (see Acceptance below).
- **7-Zip variant (071, User decision):** `7za.exe`, vendored and fetched by
  `scripts/fetch-7za.mjs`, never resolved from `PATH`. The fetch script has not been run
  end-to-end in this environment (no network access to 7-zip.org here) — the wiring is correct
  but unverified against a real download; three `it.skipIf`-gated tests wait on that.
- **Downloads defaults (072, User decision):** concurrency 2 (range 1–6, corrected from the
  story's stale 1–4 draft against 071's real committed code), 5GB archive-cache budget,
  download-while-playing allowed.
- **Failure log scope (073, User decision):** global across the app, 7-day retention for
  dismissed entries — implemented via a new additive `JobsService.onChange` multi-listener rather
  than depending on 071's still-in-flight interface at refine time.
- **Bootstrap identity & scope (074, User decisions):** default name "Q2PRO Demo", default icon,
  appended at the end of the rail's sort order; `video/`/`players/` are not copied by default —
  the wizard offers a toggle, off by default, since most players only want multiplayer.
- **Real-archive layout residue (074):** `assemble.ts`'s allowlist paths are proven against a
  fixture archive with the expected layout, not against the real, unmodified Q2PRO/id-Software
  installer archives. If the real layout differs, the game-module DLL path is the riskier half to
  get wrong — a wrong pak path fails loud (installation reported invalid); a wrong game-module
  filename fails silent (Play button lights up on an installation that cannot start a map).
  Flagged as a follow-up to verify once the real archives are in hand, not guessed at blind.
- **Bootstrap job bypasses the concurrency queue (074):** the wizard's job is one named, singular
  job, not admitted through 071's `queue.ts` pool — intentional, does not starve regular downloads,
  no acceptance criterion requires it.
- Two review-fix cycles across the sprint caught real defects before they shipped: 070's pin
  resolution trusted an id match without checking package kind/engine; 071's dev-mode 7za path
  resolver counted fixed directory levels that didn't match the real bundled main process
  (would have made every extraction fail); 072's cache eviction could have deleted 070's own
  offline manifest fallback; 073's succeeded-job fade effect could get stuck forever under
  concurrent jobs; 074's Program-Files write-dir remedy could carry a stale path onto an
  unrelated installation after a target re-pick. All fixed and re-verified before the story was
  marked done.

## Blocked / open

None. No story was blocked; no new user questions arose during refine or build beyond the
clarification round already answered at the top of this sprint.

## Acceptance

Acceptance is the test suite — every criterion below was proven by a named automated test as
part of its story's build (see each story's `## Done` section for the full AC → test mapping).

| Story | Criteria proven by tests | Manual residue |
| --- | --- | --- |
| 070 | AC1–AC6, all via unit/integration tests (`content-repo.test.ts`, `manifest-parse.test.ts`, `manifest-service.test.ts`, `shipped-manifest.test.ts`) | AC6: publishing the manifest files and the mirrored Q2PRO asset to the public `Hantsch/q2_community_content` repository needs push/publish credentials this run does not have — the reviewed files are meant to be byte-identical to what gets committed there; hashes were verified live against the real, currently-published upstream assets. |
| 071 | AC1–AC7, all via unit/integration tests (`pipeline.test.ts`, `queue.test.ts`, `fetcher.test.ts`, `extractor.test.ts`, `layering.test.ts`) | None acceptance-blocking. Non-acceptance residue: `scripts/fetch-7za.mjs` has never run end-to-end (no network access to 7-zip.org in this environment); three real-`7za.exe` tests stay `it.skipIf`-gated until it does. |
| 072 | AC1–AC6, all via e2e (`ui:flow -- settings-downloads-section`) plus unit tests | None. |
| 073 | AC1–AC5, all via e2e (`ui:flow -- downloads-tab`) plus unit tests | None. |
| 074 | AC1–AC8, all via e2e (`ui:flow -- bootstrap-wizard`) plus unit tests | None acceptance-blocking. Non-acceptance residue: the assembler's allowlist paths are verified against a fixture archive layout, not yet against the real, unmodified installer archives (see Findings above). |
| 032 | AC1–AC4, all via e2e (`ui:flow -- downloads-badge-count`) plus unit tests | None. |

One criterion (070's AC6) carries genuine manual residue — publishing to a public repository this
run has no credentials for. It is listed in `testplan.md`. Every other criterion in this sprint
was proven by a passing automated test through the real surface (`ui:verify`/`ui:flow`) where the
story described a user action, or by a unit/integration test where it did not.

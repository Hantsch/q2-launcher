---
id: 241
title: I comment a moment on the demo timeline
status: done
created: 2026-10-04
---

## Requirement

As a player reviewing a demo, when I pause I can write a comment pinned to that moment of the
timeline, see the comments as marks on the timeline, and read them with their times in the demo's
details — so I can note a mistake, a good play or a moment to show someone.

User feedback 2026-10-04: "tag on the timeline — when you press pause you create a comment on the
timeline in the sidecar; the details then show the comments and when they occur".

Today the launcher knows the playback position (0.1 s resolution, pushed every 250 ms) and the pause
state; the timeline (`DemoTimeline.tsx`) has no marks, and the sidecar (`<demo>.json`, schema v1) has
nothing time-anchored.

Concept: [replays-module.md](../../systems/replays-module.md), [demo-browser.md](../../concepts/demo-browser.md).

## Acceptance Criteria

- [x] **AC1** — While a demo is paused, the timeline offers "Add comment", which opens a text field
      anchored at the current position.
- [x] **AC2** — A saved comment is written to the demo's sidecar with its time and text, and survives
      a restart.
- [x] **AC3** — Each comment shows as a mark on the timeline's seek bar at its time; hovering or
      focusing the mark shows the text.
- [x] **AC4** — Activating a mark seeks the playing demo to that time.
- [x] **AC5** — The demo detail lists all comments sorted by time, each with its `mm:ss` time and
      text, also when no demo is playing.
- [x] **AC6** — A comment can be edited and deleted from the detail list.
- [x] **AC7** — Demos inside a zip cannot carry comments; the action is disabled and says why as
      visible text.
- [x] **AC8** — Sidecars written before this story still load unchanged; adding the first comment
      keeps every existing field.

## Open Questions

- ~~**Q1** — Only while paused, or also while playing (using the position at the click)?
  Recommendation: the button works in both states, and pausing on open is automatic — the feedback
  names pause as the trigger, not as a restriction.~~ answered → Decisions (Sprint)
- ~~**Q2** — Can a detail-list entry jump into playback when no session runs (start the demo and seek)?
  Recommendation: yes, as "Play from here".~~ answered → Decisions (Sprint)
- ~~**Q3** — Limits: max comments per demo and max text length. Recommendation: 200 comments, 500
  characters each, in line with the existing sidecar limits.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Comment button: works while paused and playing; pausing on open is automatic.
- **(User)** Detail-list entry without a session: yes, "Play from here" starts the demo and seeks.
- **(User)** Limits: 200 comments max, 500 chars each.
- Comments are an optional `comments` field in sidecar schema v1 (no version bump) — an additive
  optional field leaves every pre-241 sidecar valid as-is, which is exactly AC8.
- A comment is `{ atMs, text }` (integer ms ≥ 0, text 1–500 chars, trimmed); the list is stored
  sorted by `atMs`, equal times allowed — the store already works in ms and needs no ids.
- The time shown is `formatPlaybackPosition` (`m:ss`, `h:mm:ss` past an hour) — the same text the
  timeline shows, so a comment's time matches what the user saw.
- The comment is pinned to the position at the click, not the position after the pause lands —
  the user means the moment they saw.
- Comment changes are operations (add / edit / remove, a comment identified by its time + current
  text) applied to the freshly read sidecar inside the existing per-demo save queue — so a timeline
  add and a detail edit never overwrite each other, and no other field is ever rewritten.
- The draft save path carries `comments` through untouched — a full-replacement write from the
  detail must never drop them.
- Only the text is editable; the time is fixed — the AC asks for edit and delete, re-timing is
  delete + add.
- An edit to empty text is refused at the field with a visible reason; delete is its own × and
  needs no confirm — consistent with story 243's tag chips (no undo, explicit removal).
- Text entry is a single-line field (Enter saves, Escape cancels, Save/Cancel buttons) rendered
  inside the timeline strip under the seek bar — never above it, where the native game window sits
  over the stage.
- Marks are buttons layered over the seek bar, not children of the `role="slider"` (no nested
  interactive control); visual tick narrow, hit target 24 px (the CLAUDE.md dense floor); their
  text bubble also opens inside the strip.
- Marks only render with a known duration; a comment past the duration sits at the end.
- "Play from here" seeks directly when that demo is already the session; otherwise it plays the
  demo through the normal play path and seeks once the first position arrives; when play is not
  eligible it is disabled with the play eligibility's own visible reason.
- At 200 comments "Add comment" is disabled with a visible reason; the text field caps at 500.
- Cinema overlay and fullscreen get no comment controls (fullscreen disables timeline controls
  already) — the feedback names the docked timeline.
- Comments are not part of list search/filter — not asked for; a later story if wanted.
- "Survives a restart" is proven by the sidecar file on disk plus the detail reading it back: the
  launcher keeps no comment state outside the file, so a restart is a re-read (flows cannot restart).

## Plan

1. **Shared (D1):** `comments` in `sidecarFieldsSchema` (max 200, text 1–500), normalise (trim,
   drop empty, sort by `atMs`), serialise after `date`; draft passthrough; pure comment operations
   in a new `src/shared/replays/demo-comments.ts`. Sidecar read accepts it; old files unchanged.
2. **Detail (D2):** a "Comments" section in the demo detail: sorted list with time + text, inline
   edit, ×-delete, archive reason; writes through the per-demo queue as comment operations.
3. **Timeline (D3, hard):** the session knows its demo id; "Add comment" (pause + field in the
   strip), marks with text bubble that seek on activation; "Play from here" in the detail list
   (pending seek after start).
4. **Archive (D4):** zip demos: timeline "Add comment" disabled with visible reason; flow with a
   zip demo playing through the stub engine.
5. Systems doc `docs/systems/replays-module.md` (sidecar `comments`, components) in D1/D2/D3;
   CHANGELOG one line in D3.

Order: D1 → D2 → D3 → D4. Builds after 243 (in-place detail, save queue), 242/238/244.

## Deliverables

- **D1 — Sidecar `comments` field + comment operations (shared + main, no UI).**
  `src/shared/replays/sidecar.ts`: add `sidecarCommentSchema = z.object({ atMs: z.number().int().min(0), text: z.string().min(1).max(500) }).strict()` and `comments: z.array(sidecarCommentSchema).max(200).optional()` to `sidecarFieldsSchema` (schema version stays 1). `normalizeSidecarFields`: trim each text, drop empty ones, stable-sort by `atMs`, omit the key when empty. `serializeSidecar`: `comments` last, after `date`, each `{ atMs, text }`.
  `src/shared/replays/sidecar-draft.ts`: the draft carries `comments` through unchanged (`draftFromSidecar` keeps them, the raw-fields builder writes them back) so a draft-based save never drops them.
  New `src/shared/replays/demo-comments.ts` (pure): `type CommentOp = { kind: 'add'; atMs; text } | { kind: 'edit'; atMs; text; newText } | { kind: 'remove'; atMs; text }`; `applyCommentOp(comments | undefined, op)` → `{ ok: true, comments }` or `{ ok: false, key }` with i18n keys `replays.comments.error.limit` (201st), `.tooLong` (> 500), `.empty` (blank add/edit), `.notFound` (no comment with that time + text); identification is the first comment with equal `atMs` and `text`; result is normalised (sorted).
  `src/main/modules/replays/sidecar-read.ts` needs no special case (it walks `sidecarFieldsSchema.shape`) — prove it.
  Update `docs/systems/replays-module.md` (sidecar carries time-anchored comments; `demo-comments.ts` in the shared list).
  Tests: `src/shared/replays/sidecar.test.ts`, `src/shared/replays/sidecar-draft.test.ts`, new `src/shared/replays/demo-comments.test.ts`, `src/main/modules/replays/sidecar-read.test.ts`, `src/main/modules/replays/sidecar-store.test.ts` (names under Acceptance Tests).

- **D2 — Comments in the demo detail: list, edit, delete (renderer).**
  New `src/renderer/src/modules/replays/components/DemoCommentsList.tsx`, mounted in `components/DemoDetailPanel.tsx` (after description/tags, whatever story 243 left there), section heading "Comments", `data-testid="replays-detail-comments"`. Reads `row.sidecar.values.comments` (rows come from `ReplaysView`'s `demos`; no extra IPC). Each entry (`data-testid="replays-detail-comment"`, `data-at-ms`) shows `formatPlaybackPosition(atMs)` (`@shared/replays/timeline`) and the text; empty state text when none. Edit: pencil → in-place input (maxLength 500), Enter/blur saves, Escape reverts, blank refused with visible reason (`replays.comments.error.empty`); delete: × icon button, immediate. Archive entries (`row.archiveEntry !== null`): list stays visible read-only, edit/delete absent, visible reason `replays.comments.archiveReadOnly` ("Demos inside a zip cannot carry comments").
  Save path: extend the per-demo queued fresh-read write in `src/renderer/src/modules/replays/demo-editor-store.ts` (`quickEdit` → `quickWrite` → `withQuickEdit`, or what story 243 put in its place) with a comment op: inside the queued task, read the sidecar fresh, `applyCommentOp` (D1, `@shared/replays/demo-comments`), write, `onRowPatched` — never compute the new list from the row. A refused op or failed write shows the error inline in the section and keeps the user's text. Export a `commentEdit(id, op, onRowPatched)` action the timeline (D3) reuses.
  Strings in `src/renderer/src/modules/replays/locale/en.json` under `replays.comments.*`. Controls ≥ 28 px (`size="sm"`), visible focus.
  Tests: `components/DemoCommentsList.test.tsx`, `demo-editor-store.test.ts`; e2e flow `scripts/flows/replays-demo-comments-detail.mjs` with `export const variant = REPLAYS_TIMELINE_VARIANT` and a `setup()` that calls `writeReplaysTimelineFixture()` (`scripts/lib/fixture.mjs`) and writes `ctf/demos/play-ctf.dm2.json` (sidecar v1 with `name`, `tags`, `rating` and three unsorted comments); mirror `scripts/flows/replays-detail-quick-edit.mjs` for selection/detail and read the sidecar file from disk for assertions. Update `docs/systems/replays-module.md` renderer list.

- **D3 — Timeline: Add comment, marks, seek, Play from here (renderer).**
  `src/renderer/src/modules/replays/playback-store.ts`: `PlaybackSession` gains `demoId: string | null` and `archived: boolean` (`beginSession(demoName, knownDurationMs, demo?: { id, archived })`; `CinemaOverlay`'s `beginSession('', null)` stays valid) and `pendingSeekS: number | null`; when the first position view of a session arrives and `pendingSeekS` is set, send `{ kind: 'seekTo', seconds }` once through `sendTimeline` and clear it. `useDemoPlay.ts`: pass `demo.id` / `demo.archiveEntry !== null` and an optional `startAtS` to `play`.
  `ReplaysView.tsx`: find the session's demo in the full `demos` list by `session.demoId` and pass it plus `handleRowPatched` to `<DemoTimeline />`.
  `components/DemoTimeline.tsx` + new `components/TimelineComments.tsx`: (a) "Add comment" icon button in the controls row (`data-testid="replays-timeline-add-comment"`, disabled when fullscreen, as the other controls; disabled with visible reason `replays.comments.error.limit` at 200). Click captures the displayed position, sends `togglePause` if playing and not ended (abort on refusal), then shows a single-line field inside the strip below the seek bar (`replays-timeline-comment-field`, label with the `m:ss` time, maxLength 500, Enter/Save saves via `useDemoEditorStore.getState().commentEdit(demoId, { kind: 'add', atMs, text }, onRowPatched)` (`demo-editor-store.ts`; it reads the sidecar fresh inside the per-demo queue), Escape/Cancel closes). Nothing renders above the strip (the native game window covers the stage). (b) Marks: an absolutely positioned layer over the track, a **sibling** of the `role="slider"` element (not a child), one `<button>` per comment (`replays-timeline-comment-mark`, `data-at-ms`, 24 px hit target, narrow visual tick, `aria-label` "Comment at m:ss: text"), left = `min(1, atMs/durationMs)`; only with a known duration and not fullscreen. Hover/focus opens a text bubble inside the strip (`replays-timeline-comment-bubble`); click/Enter sends `seekTo(floor(atMs/1000))` and does not trigger the bar's own click seek.
  `components/DemoCommentsList.tsx` (from D2): per entry "Play from here" (`replays-detail-comment-play`): session on this demo → `seekTo`; else `useDemoPlay(row).play(false, startAtS)`; disabled with the eligibility's visible reason when not playable.
  CHANGELOG.md `## Unreleased` / `### Added`: one line ("Comment a moment of a demo on its timeline; comments show as marks and in the detail."). Update `docs/systems/replays-module.md` (timeline marks, pending start seek).
  Tests: `components/DemoTimeline.test.tsx`, `playback-store.test.ts` (create if missing), `components/DemoCommentsList.test.tsx`; e2e `scripts/flows/replays-demo-comments.mjs` (mirror `scripts/flows/replays-timeline.mjs`: `REPLAYS_TIMELINE_VARIANT`, stub engine command log via `replaysTimelineEngineFiles()`, `commands`/`waitForScan` from `scripts/lib/replays-copy-in.mjs`); its `setup()` writes a legacy sidecar `ctf/demos/play-ctf.dm2.json` (`schemaVersion: 1`, `name`, `tags`, `rating`, no comments).

- **D4 — Zip demos cannot carry comments on the timeline.**
  `components/DemoTimeline.tsx` / `TimelineComments.tsx`: when `session.archived`, "Add comment" is `aria-disabled` (focusable) with the visible reason `replays.comments.archiveReadOnly` in the strip (`data-testid="replays-timeline-comment-reason"`, mirror `replays-timeline-cinema-reason`); marks still show nothing (a zip entry has no sidecar comments).
  Fixture: in `scripts/lib/fixture/replays-play.mjs` add `writeReplaysCommentsArchiveFixture()` = `writeReplaysTimelineFixture()` + a `baseq2/demos/pack-play.zip` holding `demoBytesWithGameDir('baseq2')` as `zipped.dm2`, built like `writeReplaysZipPackArchive()` in `scripts/lib/fixture/replays.mjs` (vendored 7za, same guard); export it through `scripts/lib/fixture.mjs`.
  Tests: `components/DemoTimeline.test.tsx`; e2e `scripts/flows/replays-demo-comments-archive.mjs` (setup = the new fixture; plays `zipped.dm2` via `actionbar-play[data-action="view"]`, asserts timeline disabled + reason, and the detail's `replays-detail-comments` section showing the `replays.comments.archiveReadOnly` text).

## Model Hints

- D3 → deliverable-hard: the seek must fire once after the session's first position (not before
  the engine accepts commands, not again on later pushes), the marks must sit outside the slider
  without stealing or double-firing its click seek, and the field must stay inside the strip under
  the native game window — three cross-file timing/layering subtleties in one D.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-demo-comments.mjs` › "Add comment pauses the demo and opens a field at the current position"
- AC1 → unit `src/renderer/src/modules/replays/components/DemoTimeline.test.tsx` › "add comment while playing pauses first and pins the clicked position"
- AC2 → e2e `scripts/flows/replays-demo-comments.mjs` › "a saved comment is in the sidecar on disk with its time and text"
- AC2 → unit `src/main/modules/replays/sidecar-store.test.ts` › "comments round-trip through write and read"
- AC3 → e2e `scripts/flows/replays-demo-comments.mjs` › "each comment is a mark on the seek bar and shows its text on hover and focus"
- AC4 → e2e `scripts/flows/replays-demo-comments.mjs` › "activating a mark seeks the demo to its time"
- AC4 → unit `src/renderer/src/modules/replays/playback-store.test.ts` › "a pending start seek is sent once after the first position"
- AC4 → e2e `scripts/flows/replays-demo-comments.mjs` › "Play from here starts the demo and seeks to the comment"
- AC5 → e2e `scripts/flows/replays-demo-comments-detail.mjs` › "the detail lists comments sorted by time with their times, no demo playing"
- AC5 → unit `src/shared/replays/sidecar.test.ts` › "comments are normalised: trimmed, empties dropped, sorted by time"
- AC6 → e2e `scripts/flows/replays-demo-comments-detail.mjs` › "a comment is edited and deleted from the detail list"
- AC6 → unit `src/shared/replays/demo-comments.test.ts` › "add, edit and remove apply to the fresh list and refuse limit, length, empty and missing"
- AC6 → unit `src/renderer/src/modules/replays/demo-editor-store.test.ts` › "a comment op is applied to the freshly read sidecar inside the queue"
- AC7 → e2e `scripts/flows/replays-demo-comments-archive.mjs` › "a zip demo's Add comment is disabled and says why"
- AC7 → unit `src/renderer/src/modules/replays/components/DemoCommentsList.test.tsx` › "an archive entry lists comments read-only with the visible reason"
- AC8 → unit `src/main/modules/replays/sidecar-read.test.ts` › "a pre-comment v1 sidecar reads as ok with every field"
- AC8 → unit `src/shared/replays/sidecar-draft.test.ts` › "a draft save keeps the sidecar's comments"
- AC8 → e2e `scripts/flows/replays-demo-comments.mjs` › "adding the first comment keeps every existing sidecar field"

## Done

Comments are an optional `comments` array in sidecar v1 (normalised, ops applied to the freshly read sidecar in the per-demo queue). The detail lists, edits and deletes them (`DemoCommentsList`, "Play from here"); the timeline has Add comment, marks that seek, and a field inside the strip. Zip demos are read-only with a visible reason.

Commit message: `241: comment a moment on the demo timeline — sidecar comments, detail list, timeline marks, play from here`

Verification (narrow gate): build, typecheck, lint green; `npx vitest run --changed HEAD` 189 files / 1646 tests green; `src/comments.test.ts` + `src/architecture.test.ts` green. `--affected` selected nearly every flow (scripts/lib changed), too many for one call: ran the 3 story flows plus all 60 other `replays-*` flows in batches — all green except the known reds `replays-filter-search`, `replays-mod-warning` (not ours). After the review fixes the 3 story flows + `replays-timeline` re-ran green. Not run: `scripts/check-docs.test.mjs`, `scripts/flow-helper-duplication.test.mjs`.
AC → test: all 18 lines of Acceptance Tests exist, ran and passed (e2e `step:` lines in the flows, unit by name). No manual residue.
Review: default tier PASS with minor findings, all fixed (misplaced comments, duplicate limit constant, non-unique React keys + test, systems doc re-expanded to 150 lines). Unit reds found in verify (error-keys list, systems-doc length, i18n snapshot, duplicate "Cancel" value) fixed in-product.

Decisions:

- Add comment uses `aria-disabled` (focusable) so the reason is reachable; fullscreen keeps `disabled`; it only shows when the strip has the session's demo row and sits after the speed select (tab order unchanged).
- `beginSession` demo argument also takes optional `startAtS`; `commentEdit` goes through the existing `queueEdit`/`editWrite` queue, refusals return `{status:'refused', key}` and write nothing.
- Duplicate comments (same time + text) get unique keys via an occurrence counter; `replays.comments.cancel` dropped in favour of `common.action.cancel`.
- Known gap: a refusal on a replace-dialog confirm retry surfaces as `failed`, not `refused`.

tiers: D 4 / hard 1 · review default · cycles 1 · agents 9

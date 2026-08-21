/**
 * The trigger rule for the automatic write-on-change (story 023 D3).
 *
 * Pure, and deliberately free of *every* import - no React, no `./client` - so
 * the co-located test can exercise it under Vitest's `environment: 'node'`
 * (`vitest.config.ts:13`, no jsdom and no `@testing-library` here) without
 * pulling in either React or the `module:invoke` plumbing. The hook that owns
 * the `Map` and fires the actual IPC call lives next door in
 * `useProfileAutoWrite.ts`.
 *
 * The rule itself is lifted verbatim out of the pre-story-022 `WriteTargets`
 * effect, which is the only place the launcher ever had it. Restated as a
 * decision table over "what did we last see for THIS profile id":
 *
 * | previously seen | vs. current `updatedAt` | verdict           |
 * | --------------- | ----------------------- | ----------------- |
 * | nothing         | -                       | selection, no write |
 * | same value      | equal                   | no save, no write   |
 * | some value      | different               | a real save, write  |
 *
 * The first row is the one that matters most: opening a profile must never be
 * enough to write into a game folder the user did not ask to touch. The second
 * row is what makes "switch away to another profile and come back without
 * editing anything" correctly silent - the caller keeps its per-id map across
 * profile switches and never resets an entry, so on the way back the id's last
 * seen `updatedAt` is still the current one.
 *
 * Note this rule is `updatedAt`-only on purpose: `assign`/`unassign`/
 * `setDefault` deliberately stamp no clock (`assignments.ts`), so they do not
 * trigger a write here - main's own sync already runs inside those handlers.
 */
export function shouldTriggerAutoWrite(
  previouslySeenUpdatedAt: string | undefined,
  updatedAt: string,
): boolean {
  return previouslySeenUpdatedAt !== undefined && previouslySeenUpdatedAt !== updatedAt
}

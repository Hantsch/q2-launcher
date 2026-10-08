// Decision logic of the parallel flow runner (`npm run ui:flows -- --parallel=<n>`, in
// scripts/flows-all.mjs). Pure: no spawning, no filesystem. The parent process selects the flows
// exactly as a serial run does, hands each group computed here to a child flows-all with its own
// `Q2L_UI_VERIFY_ROOT`, and merges the children's gate results into one summary.
import { selectShard } from './flow-gate.mjs'

/**
 * Flows that never run next to another flow, with the reason. They run serially in the parent
 * after every parallel group has finished — the simplest design that is correct: a child never
 * has to wait for a port or a focus-free desktop, and the parent's own output root is free by
 * then. The list is checked against the flow sources by scripts/flow-parallel.test.mjs, so a new
 * flow that binds a fixed port or asserts window focus fails that test until it is listed here.
 */
export const PINNED_FLOWS = Object.freeze({
  'harness-offscreen': 'asserts the harness window never has focus',
  'replays-stage-follow': 'drives window focus, blur, minimize and restore',
  'servers-lan-mode': 'binds the fixed loopback ports 27950-27953 and 27955',
  'servers-lan-no-scan-while-playing': 'binds the fixed loopback ports 27953 and 27955',
  'servers-list-states': 'binds the fixed loopback ports 27950-27953',
})

/** `<root>/shard-<i>`'s last segment: the output root of the i-th child, 1-based. */
export function shardRootName(index) {
  return `shard-${index}`
}

/**
 * Splits the selected flows into at most `count` round-robin groups of the flows that may run
 * concurrently, plus the pinned flows in selection order. A group is never empty: fewer flows
 * than `count` means fewer groups.
 */
export function partitionFlows(names, count, pinned = PINNED_FLOWS) {
  const free = names.filter((name) => !(name in pinned))
  const serial = names.filter((name) => name in pinned)
  const groupCount = Math.min(count, free.length)
  const groups = Array.from({ length: groupCount }, (_, k) => selectShard(free, k + 1, groupCount))
  return { groups, pinned: serial }
}

/** The plan as the parent announces it before the children start. */
export function planLines({ groups, pinned }, count, pinnedReasons = PINNED_FLOWS) {
  const lines = [
    `parallel: ${groups.length} of ${count} requested groups` +
      `${pinned.length > 0 ? `, then ${pinned.length} pinned flow(s) serially` : ''}`,
  ]
  groups.forEach((group, k) => {
    lines.push(`  shard ${k + 1}: ${group.length} flow(s) under ${shardRootName(k + 1)}/`)
  })
  for (const name of pinned) lines.push(`  pinned: ${name} (${pinnedReasons[name]})`)
  return lines
}

const LISTS = ['failed', 'expectedFails', 'unexpectedPasses', 'flaky', 'notes']

/**
 * The gate result of a child that ended without writing its report: every flow it was given
 * counts as failed, because nothing says otherwise.
 */
export function unreportedResult(names, label, status) {
  return {
    ok: false,
    failed: [...names],
    expectedFails: [],
    unexpectedPasses: [],
    flaky: [],
    configErrors: [],
    notes: [
      `${label}: exited with ${status === null ? 'a signal' : `status ${status}`} without a report — its ${names.length} flow(s) count as failed`,
    ],
    total: names.length,
  }
}

/**
 * One gate result from many, in the order given. `total` adds up; config errors are deduplicated
 * because every child validates the same quarantine list and would repeat the same message.
 */
export function mergeResults(results) {
  const merged = Object.fromEntries(LISTS.map((key) => [key, []]))
  merged.ok = results.every((result) => result.ok)
  merged.configErrors = [...new Set(results.flatMap((result) => result.configErrors))]
  merged.total = results.reduce((sum, result) => sum + result.total, 0)
  for (const result of results) {
    for (const key of LISTS) merged[key].push(...result[key])
  }
  return merged
}

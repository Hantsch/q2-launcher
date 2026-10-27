/**
 * Everything a `.dm2` demo's single frame-count pass collects besides the count: the roster
 * (`./dm2-roster.ts`) and the recording player's end-of-match stats (`./dm2-stats.ts`).
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import type { Dm2FrameObserver } from './dm2-frames'
import { createDm2RosterCollector } from './dm2-roster'
import type { DemoRoster } from './dm2-roster'
import { createDm2StatsCollector } from './dm2-stats'
import type { DemoStats } from './dm2-stats'

export type Dm2FactsCollector = Dm2FrameObserver & {
  finish(): { roster: DemoRoster | null; stats: DemoStats | null }
}

export function createDm2FactsCollector(): Dm2FactsCollector {
  const roster = createDm2RosterCollector()
  const stats = createDm2StatsCollector()
  return {
    onServerdata: (protocol) => roster.onServerdata(protocol),
    onConfigstring: (index, value) => roster.onConfigstring(index, value),
    onLayout: (text) => roster.onLayout(text),
    onPrint: (level, text) => stats.onPrint(level, text),
    finish: () => ({ roster: roster.finish(), stats: stats.finish() }),
  }
}

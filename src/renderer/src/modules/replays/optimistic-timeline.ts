import type { PlaybackView, TimelineAction } from '@shared/replays/timeline'

/**
 * Story 184 D1: the demo timeline's expected state - the last accepted readback plus the commands
 * still in flight - and the position projected between readbacks.
 *
 * Pure by contract: no React, no timers, no IPC. Every time-dependent function takes `now` (ms,
 * any monotonic clock) as a parameter; every function returns a new state and never mutates.
 *
 * Three independent chains of pending commands:
 * - `pause`: every toggle sent and not yet seen in a readback. Expected paused = confirmed paused
 *   XOR an odd number of pending toggles.
 * - `position`: every jump/seekTo sent and not yet seen, each carrying the clamped target it leads
 *   to. A jump builds on the previous entry's target, so two quick +10 jumps show +20 at once.
 * - `speed`: at most one pending value; the engine never reads speed back, so it resolves only
 *   through `confirmSpeed` / `refuse`.
 *
 * A readback is matched against hypotheses (the confirmed position and each pending target, all
 * projected to `now`). A readback that still shows the pre-command state is stale and changes no
 * chain; one at an intermediate target confirms the chain up to it; one matching nothing wins.
 */

export type TimelineChain = 'pause' | 'position' | 'speed'

/** Actions that travel to the engine as a command; `fullscreen` is handled by the launcher. */
export type QueuedTimelineAction = Exclude<TimelineAction, { kind: 'fullscreen' }>
type PositionAction = Extract<TimelineAction, { kind: 'jump' | 'seekTo' }>

interface PendingEntry {
  id: number
  /** `now` at the moment the command was sent. */
  sentAt: number
}

export type PendingPause = PendingEntry

export interface PendingPosition extends PendingEntry {
  action: PositionAction
  /** Where the chain stood when this entry was queued: the previous entry's target, or the display. */
  baseMs: number
  /** The clamped position this command leads to. */
  targetMs: number
}

export interface PendingSpeed extends PendingEntry {
  value: number
}

export interface ConfirmedTimeline {
  positionMs: number
  paused: boolean
  /** Receipt time of the readback `positionMs` belongs to; projection runs from here. */
  anchorAt: number
  speed: number
}

export interface OptimisticTimeline {
  confirmed: ConfirmedTimeline
  /** Null while the demo's length is unknown; positions are then only clamped at 0. */
  durationMs: number | null
  /** The previous readback as received, to tell a changed readback from an unchanged repeat. */
  lastReadback: { positionMs: number; paused: boolean } | null
  pause: readonly PendingPause[]
  position: readonly PendingPosition[]
  speed: PendingSpeed | null
  nextId: number
}

export interface ExpectedTimeline {
  positionMs: number
  paused: boolean
  speed: number
}

/** Projection never runs further than this past its anchor without a new readback. */
export const PROJECTION_CAP_MS = 3000
/** A readback matches a hypothesis within this distance, scaled up by speeds above 1x. */
export const MATCH_TOLERANCE_MS = 1500
/** A chain whose oldest entry is this old is shown as waiting. */
export const WAITING_AFTER_MS = 1000
/** A chain whose newest entry is this old is dropped. */
export const GIVE_UP_AFTER_MS = 5000

const knownDuration = (d: number | null | undefined): number | null =>
  d !== null && d !== undefined && Number.isFinite(d) && d > 0 ? d : null

function clampPosition(ms: number, durationMs: number | null): number {
  const floored = Math.max(0, ms)
  return durationMs === null ? floored : Math.min(durationMs, floored)
}

/** `pos` advanced by the time played since `from` (capped at 3 s), clamped to the demo. */
export function project(
  pos: number,
  from: number,
  now: number,
  speed: number,
  paused: boolean,
  durationMs: number | null
): number {
  const played = paused ? 0 : Math.min(PROJECTION_CAP_MS, Math.max(0, now - from))
  return clampPosition(pos + played * speed, durationMs)
}

export function createTimeline(
  init: { view: PlaybackView | null; durationMs?: number | null; speed?: number },
  now: number
): OptimisticTimeline {
  const { view } = init
  return {
    confirmed: {
      positionMs: view?.positionMs ?? 0,
      paused: view?.paused ?? false,
      anchorAt: now,
      speed: init.speed ?? 1
    },
    durationMs: knownDuration(view?.durationMs) ?? knownDuration(init.durationMs),
    lastReadback: view === null ? null : { positionMs: view.positionMs, paused: view.paused },
    pause: [],
    position: [],
    speed: null,
    nextId: 1
  }
}

function expectedPaused(s: OptimisticTimeline): boolean {
  return s.confirmed.paused !== (s.pause.length % 2 === 1)
}

function expectedSpeed(s: OptimisticTimeline): number {
  return s.speed?.value ?? s.confirmed.speed
}

/**
 * Time played in [from, now] as the chains expect it: paused = confirmed XOR the toggles sent so
 * far. A toggle sent after `from` splits the window, so pausing freezes the display where it stood
 * when the pause was sent, and resuming after a long pause does not jump ahead by the time paused.
 * With no toggle inside the window this is exactly `project`'s paused/elapsed rule.
 */
function playedMs(s: OptimisticTimeline, from: number, now: number): number {
  if (now <= from) return 0
  let paused = s.confirmed.paused !== (s.pause.filter((e) => e.sentAt <= from).length % 2 === 1)
  const flips = s.pause
    .map((e) => e.sentAt)
    .filter((t) => t > from && t < now)
    .sort((a, b) => a - b)
  let cursor = from
  let played = 0
  for (const t of flips) {
    if (!paused) played += t - cursor
    paused = !paused
    cursor = t
  }
  if (!paused) played += now - cursor
  return played
}

function projectExpected(s: OptimisticTimeline, pos: number, from: number, now: number): number {
  return project(pos, 0, playedMs(s, from, now), expectedSpeed(s), false, s.durationMs)
}

export function expected(s: OptimisticTimeline, now: number): ExpectedTimeline {
  const last = s.position[s.position.length - 1]
  return {
    positionMs:
      last === undefined
        ? projectExpected(s, s.confirmed.positionMs, s.confirmed.anchorAt, now)
        : projectExpected(s, last.targetMs, last.sentAt, now),
    paused: expectedPaused(s),
    speed: expectedSpeed(s)
  }
}

function targetFor(action: PositionAction, baseMs: number, durationMs: number | null): number {
  const raw = action.kind === 'jump' ? baseMs + action.deltaS * 1000 : action.seconds * 1000
  return clampPosition(raw, durationMs)
}

export function enqueue(
  s: OptimisticTimeline,
  action: QueuedTimelineAction,
  now: number
): { state: OptimisticTimeline; id: number } {
  const id = s.nextId
  const next = { ...s, nextId: id + 1 }
  switch (action.kind) {
    case 'togglePause':
      return { state: { ...next, pause: [...s.pause, { id, sentAt: now }] }, id }
    case 'speed':
      return { state: { ...next, speed: { id, sentAt: now, value: action.value } }, id }
    case 'jump':
    case 'seekTo': {
      const last = s.position[s.position.length - 1]
      const baseMs = last === undefined ? expected(s, now).positionMs : last.targetMs
      const entry: PendingPosition = {
        id,
        sentAt: now,
        action,
        baseMs,
        targetMs: targetFor(action, baseMs, s.durationMs)
      }
      return { state: { ...next, position: [...s.position, entry] }, id }
    }
  }
}

/** Resolves the pause and position chains against a readback received at `now`. */
export function applyReadback(s: OptimisticTimeline, view: PlaybackView, now: number): OptimisticTimeline {
  // Pause: a readback showing the expected state confirms every pending toggle; any other is stale.
  const pauseStale = s.pause.length > 0 && view.paused !== expectedPaused(s)

  // Position: hypotheses are what the pre-readback state expected at `now`.
  let position = s.position
  if (position.length > 0) {
    const hypotheses = [
      projectExpected(s, s.confirmed.positionMs, s.confirmed.anchorAt, now),
      ...position.map((e) => projectExpected(s, e.targetMs, e.sentAt, now))
    ]
    let best = 0
    let bestDistance = Infinity
    hypotheses.forEach((h, i) => {
      const distance = Math.abs(view.positionMs - h)
      // `<=`: on a tie the later hypothesis wins - identical targets are indistinguishable.
      if (distance <= bestDistance) {
        best = i
        bestDistance = distance
      }
    })
    if (bestDistance > MATCH_TOLERANCE_MS * Math.max(1, expectedSpeed(s))) position = []
    else if (best >= 1) position = position.slice(best)
    // best === 0: the engine has not reached any pending command yet; the chain stays.
  }

  const paused = pauseStale ? s.confirmed.paused : view.paused
  const prev = s.lastReadback
  const changed =
    prev === null ||
    prev.positionMs !== view.positionMs ||
    prev.paused !== view.paused ||
    paused !== s.confirmed.paused

  return {
    ...s,
    confirmed: {
      positionMs: view.positionMs,
      paused,
      anchorAt: changed ? now : s.confirmed.anchorAt,
      speed: s.confirmed.speed
    },
    durationMs: knownDuration(view.durationMs) ?? s.durationMs,
    lastReadback: { positionMs: view.positionMs, paused: view.paused },
    pause: pauseStale ? s.pause : [],
    position
  }
}

export function confirmSpeed(s: OptimisticTimeline, id: number): OptimisticTimeline {
  if (s.speed === null || s.speed.id !== id) return s
  return { ...s, confirmed: { ...s.confirmed, speed: s.speed.value }, speed: null }
}

/** Drops a refused command; later position targets are rebuilt from the remaining chain. */
export function refuse(s: OptimisticTimeline, id: number): OptimisticTimeline {
  if (s.speed !== null && s.speed.id === id) return { ...s, speed: null }
  if (s.pause.some((e) => e.id === id)) return { ...s, pause: s.pause.filter((e) => e.id !== id) }
  const k = s.position.findIndex((e) => e.id === id)
  if (k < 0) return s
  const position = s.position.slice(0, k)
  let baseMs = s.position[k].baseMs
  for (const e of s.position.slice(k + 1)) {
    const targetMs = targetFor(e.action, baseMs, s.durationMs)
    position.push({ ...e, baseMs, targetMs })
    baseMs = targetMs
  }
  return { ...s, position }
}

function chainEntries(s: OptimisticTimeline): Array<[TimelineChain, readonly PendingEntry[]]> {
  return [
    ['pause', s.pause],
    ['position', s.position],
    ['speed', s.speed === null ? [] : [s.speed]]
  ]
}

/** Chains whose oldest pending entry has waited at least 1 s for its readback. */
export function waiting(s: OptimisticTimeline, now: number): Set<TimelineChain> {
  const out = new Set<TimelineChain>()
  for (const [chain, entries] of chainEntries(s)) {
    if (entries.length > 0 && now - entries[0].sentAt >= WAITING_AFTER_MS) out.add(chain)
  }
  return out
}

/** Drops every chain whose newest entry is at least 5 s old; the confirmed state shows again. */
export function giveUp(s: OptimisticTimeline, now: number): OptimisticTimeline {
  const stale = (entries: readonly PendingEntry[]): boolean =>
    entries.length > 0 && now - entries[entries.length - 1].sentAt >= GIVE_UP_AFTER_MS
  const drop = new Set(chainEntries(s).filter(([, e]) => stale(e)).map(([chain]) => chain))
  if (drop.size === 0) return s
  return {
    ...s,
    pause: drop.has('pause') ? [] : s.pause,
    position: drop.has('position') ? [] : s.position,
    speed: drop.has('speed') ? null : s.speed
  }
}

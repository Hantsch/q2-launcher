import { describe, expect, it } from 'vitest'
import { JUMP_STEP_S, PAGE_STEP_S, type PlaybackView } from '@shared/replays/timeline'
import {
  applyReadback,
  confirmSpeed,
  createTimeline,
  enqueue,
  expected,
  giveUp,
  project,
  refuse,
  waiting,
  type OptimisticTimeline,
  type QueuedTimelineAction,
} from './optimistic-timeline'

const DURATION = 600_000

function view(
  positionMs: number,
  paused = false,
  durationMs: number | null = DURATION,
): PlaybackView {
  return { positionMs, durationMs, paused, ended: false, stillCount: 0 }
}

/** Queues actions in order at the given times and returns the state plus their ids. */
function send(
  s: OptimisticTimeline,
  ...steps: Array<[QueuedTimelineAction, number]>
): {
  state: OptimisticTimeline
  ids: number[]
} {
  const ids: number[] = []
  let state = s
  for (const [action, now] of steps) {
    const r = enqueue(state, action, now)
    state = r.state
    ids.push(r.id)
  }
  return { state, ids }
}

const jump = (deltaS: number): QueuedTimelineAction =>
  ({ kind: 'jump', deltaS }) as QueuedTimelineAction
const toggle: QueuedTimelineAction = { kind: 'togglePause' }

describe('project', () => {
  it('advances by elapsed time times speed while playing, capped at 3 s and clamped', () => {
    expect(project(10_000, 0, 1000, 1, false, DURATION)).toBe(11_000)
    expect(project(10_000, 0, 1000, 2, false, DURATION)).toBe(12_000)
    expect(project(10_000, 0, 10_000, 1, false, DURATION)).toBe(13_000)
    expect(project(10_000, 0, 1000, 1, true, DURATION)).toBe(10_000)
    expect(project(599_500, 0, 2000, 1, false, DURATION)).toBe(DURATION)
    expect(project(-50, 0, 0, 1, false, DURATION)).toBe(0)
    expect(project(700_000, 0, 1000, 1, false, null)).toBe(701_000)
  })
})

describe('enqueue', () => {
  it('two quick jumps accumulate to +20', () => {
    const start = createTimeline({ view: view(30_000, true) }, 0)
    const { state } = send(start, [jump(JUMP_STEP_S), 100], [jump(JUMP_STEP_S), 150])
    expect(expected(state, 200).positionMs).toBe(30_000 + 2 * JUMP_STEP_S * 1000)
  })

  it('a first jump builds on the displayed, projected position', () => {
    const start = createTimeline({ view: view(30_000) }, 0)
    const { state } = send(start, [jump(JUMP_STEP_S), 500])
    expect(expected(state, 500).positionMs).toBe(40_500)
  })

  it('a seekTo targets its second', () => {
    const start = createTimeline({ view: view(30_000, true) }, 0)
    const { state } = send(start, [{ kind: 'seekTo', seconds: 120 }, 100], [jump(JUMP_STEP_S), 150])
    expect(expected(state, 200).positionMs).toBe(130_000)
  })

  it('clamps targets to the demo and builds later jumps on the clamped target', () => {
    const start = createTimeline({ view: view(5_000, true) }, 0)
    expect(expected(send(start, [jump(-JUMP_STEP_S), 10]).state, 20).positionMs).toBe(0)
    expect(expected(send(start, [{ kind: 'seekTo', seconds: 900 }, 10]).state, 20).positionMs).toBe(
      DURATION,
    )

    const nearEnd = createTimeline({ view: view(580_000, true) }, 0)
    const { state } = send(nearEnd, [jump(PAGE_STEP_S), 10], [jump(-JUMP_STEP_S), 20])
    expect(expected(state, 30).positionMs).toBe(DURATION - JUMP_STEP_S * 1000)
  })

  it('returns a distinct id per entry', () => {
    const { ids } = send(
      createTimeline({ view: view(0) }, 0),
      [toggle, 0],
      [jump(JUMP_STEP_S), 0],
      [{ kind: 'speed', value: 2 }, 0],
    )
    expect(new Set(ids).size).toBe(3)
  })
})

describe('expected', () => {
  it('pause is the confirmed state XOR an odd number of pending toggles', () => {
    const playing = createTimeline({ view: view(10_000, false) }, 0)
    expect(expected(send(playing, [toggle, 10]).state, 20).paused).toBe(true)
    expect(expected(send(playing, [toggle, 10], [toggle, 20]).state, 30).paused).toBe(false)
    expect(expected(send(playing, [toggle, 10], [toggle, 20], [toggle, 30]).state, 40).paused).toBe(
      true,
    )
    const paused = createTimeline({ view: view(10_000, true) }, 0)
    expect(expected(send(paused, [toggle, 10]).state, 20).paused).toBe(false)
  })

  it('a pending speed is the expected speed', () => {
    const start = createTimeline({ view: view(10_000) }, 0)
    const { state } = send(start, [{ kind: 'speed', value: 2 }, 0])
    expect(expected(state, 1000).speed).toBe(2)
    expect(expected(state, 1000).positionMs).toBe(12_000)
  })

  it('pausing freezes the display where it stood when the pause was sent', () => {
    const start = createTimeline({ view: view(10_000) }, 0)
    const { state } = send(start, [toggle, 1000])
    expect(expected(state, 2500)).toMatchObject({ positionMs: 11_000, paused: true })
  })

  it('resuming after a long pause does not jump ahead by the time spent paused', () => {
    const start = createTimeline({ view: view(50_000, true) }, 0)
    const { state } = send(start, [toggle, 60_000])
    expect(expected(state, 60_200)).toMatchObject({ positionMs: 50_200, paused: false })
  })
})

describe('applyReadback: projection anchor', () => {
  it('an unchanged repeat readback keeps projecting', () => {
    let s = createTimeline({ view: view(10_000) }, 0)
    s = applyReadback(s, view(10_000), 500)
    expect(expected(s, 1000).positionMs).toBe(11_000)
  })

  it('projection stops after 3 s without a new readback', () => {
    const s = createTimeline({ view: view(10_000) }, 0)
    expect(expected(s, 3000).positionMs).toBe(13_000)
    expect(expected(s, 5000).positionMs).toBe(13_000)
  })

  it('a changed readback re-anchors the projection', () => {
    let s = createTimeline({ view: view(10_000) }, 0)
    s = applyReadback(s, view(10_400), 500)
    expect(expected(s, 1000).positionMs).toBe(10_900)
  })

  it('with empty chains a changed readback always wins', () => {
    let s = createTimeline({ view: view(10_000) }, 0)
    s = applyReadback(s, view(90_000), 250)
    expect(expected(s, 250)).toMatchObject({ positionMs: 90_000, paused: false })
    s = applyReadback(s, view(90_000, true), 500)
    expect(expected(s, 1500)).toMatchObject({ positionMs: 90_000, paused: true })
  })

  it('takes the duration from the readback', () => {
    let s = createTimeline({ view: null, durationMs: null }, 0)
    s = applyReadback(s, view(10_000, true, 20_000), 0)
    expect(expected(send(s, [jump(PAGE_STEP_S), 10]).state, 20).positionMs).toBe(20_000)
  })
})

describe('applyReadback: pause chain', () => {
  it('a readback still showing the old pause state is stale and keeps the chain', () => {
    const start = createTimeline({ view: view(10_000) }, 0)
    let s = send(start, [toggle, 1000]).state
    s = applyReadback(s, view(11_000), 1200)
    expect(expected(s, 1300).paused).toBe(true)
    expect(s.pause).toHaveLength(1)
  })

  it('a readback showing the expected pause state confirms the chain', () => {
    const start = createTimeline({ view: view(10_000) }, 0)
    let s = send(start, [toggle, 1000]).state
    s = applyReadback(s, view(11_050, true), 1400)
    expect(s.pause).toHaveLength(0)
    expect(expected(s, 3000)).toMatchObject({ positionMs: 11_050, paused: true })
  })
})

describe('applyReadback: position chain', () => {
  it('a stale readback keeps the pending target', () => {
    const start = createTimeline({ view: view(30_000) }, 0)
    let s = send(start, [jump(JUMP_STEP_S), 100]).state
    s = applyReadback(s, view(30_400), 400)
    expect(s.position).toHaveLength(1)
    expect(expected(s, 500).positionMs).toBe(40_500)
  })

  it('a readback at an intermediate target confirms only up to it', () => {
    const start = createTimeline({ view: view(30_000, true) }, 0)
    let s = send(
      start,
      [jump(JUMP_STEP_S), 100],
      [jump(JUMP_STEP_S), 150],
      [jump(JUMP_STEP_S), 200],
    ).state
    s = applyReadback(s, view(50_000, true), 400)
    expect(s.position.map((e) => e.targetMs)).toEqual([60_000])
    expect(expected(s, 500).positionMs).toBe(60_000)
  })

  it('a readback at the last target clears the chain', () => {
    const start = createTimeline({ view: view(30_000, true) }, 0)
    let s = send(start, [jump(JUMP_STEP_S), 100]).state
    s = applyReadback(s, view(40_200, true), 400)
    expect(s.position).toHaveLength(0)
    expect(expected(s, 500).positionMs).toBe(40_200)
  })

  it('a readback matching no hypothesis wins', () => {
    const start = createTimeline({ view: view(30_000, true) }, 0)
    let s = send(start, [jump(JUMP_STEP_S), 100]).state
    s = applyReadback(s, view(90_000, true), 400)
    expect(s.position).toHaveLength(0)
    expect(expected(s, 500).positionMs).toBe(90_000)
  })

  it('the match tolerance widens with speed', () => {
    const at = (speed: number): OptimisticTimeline => {
      const start = createTimeline({ view: view(30_000, true), speed }, 0)
      const s = send(
        start,
        [jump(JUMP_STEP_S), 100],
        [jump(JUMP_STEP_S), 150],
        [jump(JUMP_STEP_S), 200],
      ).state
      return applyReadback(s, view(44_000, true), 400)
    }
    // 4 s from the first target: within 1.5 s x 4 at 4x, outside 1.5 s at 1x.
    expect(at(4).position.map((e) => e.targetMs)).toEqual([50_000, 60_000])
    expect(at(1).position).toHaveLength(0)
    expect(expected(at(1), 500).positionMs).toBe(44_000)
  })

  it('a resume and a jump sent together survive the first readback that shows only the resume', () => {
    const start = createTimeline({ view: view(50_000, true) }, 0)
    let s = send(start, [toggle, 60_000], [jump(JUMP_STEP_S), 60_050]).state
    s = applyReadback(s, view(50_100, false), 60_300)
    expect(s.pause).toHaveLength(0)
    expect(s.position).toHaveLength(1)
    expect(expected(s, 60_400)).toMatchObject({ positionMs: 60_400, paused: false })
  })
})

describe('confirmSpeed and refuse', () => {
  it('confirmSpeed makes the pending speed the confirmed one', () => {
    const r = enqueue(createTimeline({ view: view(0) }, 0), { kind: 'speed', value: 4 }, 0)
    const s = confirmSpeed(r.state, r.id)
    expect(s.speed).toBeNull()
    expect(s.confirmed.speed).toBe(4)
  })

  it('a refused speed reverts to the confirmed speed', () => {
    const r = enqueue(
      createTimeline({ view: view(0), speed: 2 }, 0),
      { kind: 'speed', value: 4 },
      0,
    )
    expect(expected(refuse(r.state, r.id), 0).speed).toBe(2)
  })

  it('a refused toggle no longer counts toward the expected pause state', () => {
    const r = enqueue(createTimeline({ view: view(0) }, 0), toggle, 0)
    expect(expected(refuse(r.state, r.id), 0).paused).toBe(false)
  })

  it('refusing a jump recomputes the later targets from the remaining chain', () => {
    const start = createTimeline({ view: view(30_000, true) }, 0)
    const { state, ids } = send(
      start,
      [jump(JUMP_STEP_S), 10],
      [jump(JUMP_STEP_S), 20],
      [jump(PAGE_STEP_S), 30],
    )
    const s = refuse(state, ids[0])
    expect(s.position.map((e) => e.targetMs)).toEqual([40_000, 100_000])
    expect(expected(s, 40).positionMs).toBe(100_000)
  })

  it('refusing a seekTo rebuilds a following jump from where the chain stood before it', () => {
    const start = createTimeline({ view: view(30_000, true) }, 0)
    const { state, ids } = send(
      start,
      [{ kind: 'seekTo', seconds: 100 }, 10],
      [jump(JUMP_STEP_S), 20],
    )
    expect(expected(refuse(state, ids[0]), 30).positionMs).toBe(40_000)
  })
})

describe('waiting and giveUp', () => {
  it('a chain is waiting once its oldest entry is 1 s old', () => {
    const start = createTimeline({ view: view(0) }, 0)
    const { state } = send(
      start,
      [toggle, 0],
      [jump(JUMP_STEP_S), 500],
      [{ kind: 'speed', value: 2 }, 800],
      [jump(JUMP_STEP_S), 1200],
    )
    expect([...waiting(state, 999)]).toEqual([])
    expect([...waiting(state, 1000)]).toEqual(['pause'])
    expect([...waiting(state, 1500)].sort()).toEqual(['pause', 'position'])
    expect([...waiting(state, 1800)].sort()).toEqual(['pause', 'position', 'speed'])
  })

  it('giveUp drops a chain once its newest entry is 5 s old', () => {
    const start = createTimeline({ view: view(30_000, true) }, 0)
    const { state } = send(start, [toggle, 0], [jump(JUMP_STEP_S), 0], [jump(JUMP_STEP_S), 3000])
    const early = giveUp(state, 5000)
    expect(early.pause).toHaveLength(0)
    expect(early.position).toHaveLength(2)
    const late = giveUp(early, 8000)
    expect(late.position).toHaveLength(0)
    expect(expected(late, 8000)).toMatchObject({ positionMs: 30_000, paused: true })
  })
})

import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_HOME_LAYOUT, type HomeLayout } from '@shared/modules/home'
import { StateStore } from '../../services/state'
import { homeState, parseHomeLayout } from './persisted'
import { configState } from '../config/persisted'

// Story 086 D1 (AC10/AC11).
describe('parseHomeLayout (story 086 D1)', () => {
  it('a record for an unknown module id is dropped', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'nope', x: 6, y: 0, w: 6, h: 5 },
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })

  it('a module missing from the layout is not inserted', () => {
    const layout = parseHomeLayout({
      tiles: [{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
    expect(layout.tiles).toHaveLength(1)
  })

  it('garbage input falls back to the default layout', () => {
    expect(parseHomeLayout(undefined)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(parseHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(parseHomeLayout('not an object')).toEqual(DEFAULT_HOME_LAYOUT)
    expect(parseHomeLayout({ tiles: 'not an array' })).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('drops a tile row missing a required coordinate', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'configProfiles', x: 6, y: 0, w: 6 }, // missing h
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })

  // Review fix (code review of story 086): a non-integer coordinate is as malformed as a missing
  // one, and is dropped the same way.
  it('drops a tile row with a non-integer coordinate', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'configProfiles', x: 2.5, y: 0, w: 6, h: 5 },
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })

  // Review fix (code review of story 086): a negative coordinate is as malformed as a missing one,
  // and is dropped the same way.
  it('drops a tile row with a negative coordinate', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'configProfiles', x: 6, y: -1, w: 6, h: 5 },
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })

  // Review fix (code review of story 086): two rows naming the same moduleId would otherwise
  // produce duplicate React keys in DashboardGrid/DashboardTile's `.map()`. Only the first
  // occurrence is kept.
  it('drops a later row that repeats a moduleId already seen, keeping the first', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'playtime', x: 6, y: 0, w: 6, h: 5 },
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })
})

describe('homeState', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-home-layout-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('starts with the default layout', () => {
    expect(homeState(state).get()).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('homeLayout round-trips through state.json and touches no other setting', async () => {
    const settingsBefore = state.settings()
    const installationsBefore = state.installations()
    const configProfilesBefore = configState(state).profiles.get()

    const custom: HomeLayout = {
      tiles: [{ moduleId: 'playtime', x: 0, y: 0, w: 4, h: 4 }],
    }
    const written = homeState(state).update(() => custom)
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(homeState(reloaded).get()).toEqual(written)
    expect(homeState(reloaded).get()).toEqual(custom)
    // Other state keys are untouched by this write.
    expect(reloaded.settings()).toEqual(settingsBefore)
    expect(reloaded.installations()).toEqual(installationsBefore)
    expect(configState(reloaded).profiles.get()).toEqual(configProfilesBefore)
  })

  it('a record for an unknown module id read from disk is gone after reload', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        homeLayout: {
          tiles: [
            { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
            { moduleId: 'nope', x: 6, y: 0, w: 6, h: 5 },
          ],
        },
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(homeState(reloaded).get().tiles).toEqual([
      { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { parseDemoName, SHIPPED_NAME_PATTERNS } from '../replays/name-patterns'
import { AUTORECORD_RECIPES, applyAutorecord, readAutorecord } from './autorecord'

const COMMAND = 'record ${cl_mapname}_${com_date}_${com_time}'

describe('autorecord recipes (story 168 D1)', () => {
  it('r1q2 on writes cl_autorecord 1 and off removes it', () => {
    const on = applyAutorecord({ name: 'x' }, 'r1q2', true)
    expect(on).toEqual({ name: 'x', cl_autorecord: '1' })
    expect(readAutorecord(on, 'r1q2')).toEqual({ kind: 'available', engine: 'r1q2', on: true })
    const off = applyAutorecord(on, 'r1q2', false)
    expect(off).toEqual({ name: 'x' })
    expect('cl_autorecord' in off).toBe(false)
    expect(readAutorecord(off, 'r1q2')).toEqual({ kind: 'available', engine: 'r1q2', on: false })
    expect(readAutorecord({ cl_autorecord: '0' }, 'r1q2')).toMatchObject({ on: false })
    expect(readAutorecord({ cl_autorecord: ' 2 ' }, 'r1q2')).toMatchObject({ on: true })
  })

  it('q2pro on writes the cl_beginmapcmd recipe and com_time_format byte-for-byte', () => {
    const input = { name: 'x' }
    const on = applyAutorecord(input, 'q2pro', true)
    expect(input).toEqual({ name: 'x' })
    expect(on).toEqual({
      name: 'x',
      cl_beginmapcmd: 'record ${cl_mapname}_${com_date}_${com_time}',
      com_time_format: '%H-%M-%S',
    })
    expect(readAutorecord(on, 'q2pro')).toEqual({ kind: 'available', engine: 'q2pro', on: true })
  })

  it('a recipe pasted exactly as players share it reads as on', () => {
    const pasted = {
      cl_beginmapcmd: 'record ${cl_mapname}_${com_date}_${com_time}',
      com_date_format: '%Y-%m-%d',
      com_time_format: '%H-%M-%S',
    }
    expect(readAutorecord(pasted, 'q2pro')).toMatchObject({ kind: 'available', on: true })
    // Sloppy spacing and neighbours still read as on.
    expect(
      readAutorecord(
        { cl_beginmapcmd: '  say hi ;  record   ${cl_mapname}_${com_date}_${com_time} ;' },
        'q2pro',
      ),
    ).toMatchObject({ on: true })
    // A different command is not the recipe.
    expect(readAutorecord({ cl_beginmapcmd: 'record demo' }, 'q2pro')).toMatchObject({ on: false })
  })

  it("a foreign cl_beginmapcmd is kept: on appends with ';' and off restores it", () => {
    const foreign = { cl_beginmapcmd: 'say hello;' }
    const on = applyAutorecord(foreign, 'q2pro', true)
    expect(on.cl_beginmapcmd).toBe(`say hello; ${COMMAND}`)
    const off = applyAutorecord(on, 'q2pro', false)
    expect(off).toEqual({ cl_beginmapcmd: 'say hello' })
    expect(readAutorecord(off, 'q2pro')).toMatchObject({ on: false })
    // A blank value counts as absent.
    expect(applyAutorecord({ cl_beginmapcmd: '  ' }, 'q2pro', true).cl_beginmapcmd).toBe(COMMAND)
  })

  it('switching on twice appends once', () => {
    const once = applyAutorecord({ cl_beginmapcmd: 'say hello' }, 'q2pro', true)
    const twice = applyAutorecord(once, 'q2pro', true)
    expect(twice).toEqual(once)
    expect(twice.cl_beginmapcmd!.split(COMMAND).length - 1).toBe(1)
    // Idempotent even with a stale time format: it is asserted again.
    expect(
      applyAutorecord({ cl_beginmapcmd: COMMAND, com_time_format: '%H:%M' }, 'q2pro', true),
    ).toEqual({ cl_beginmapcmd: COMMAND, com_time_format: '%H-%M-%S' })
  })

  it('com_time_format is removed on off only while it is still ours', () => {
    const ours = applyAutorecord({}, 'q2pro', true)
    expect(applyAutorecord(ours, 'q2pro', false)).toEqual({})
    const edited = { ...ours, com_time_format: '%H:%M' }
    expect(applyAutorecord(edited, 'q2pro', false)).toEqual({ com_time_format: '%H:%M' })
  })

  it('vanilla and unknown engines are unavailable', () => {
    const cvars = { cl_autorecord: '1', cl_beginmapcmd: COMMAND }
    for (const engine of ['vanilla', 'yquake2', 'unknown', 'custom', null] as const) {
      expect(readAutorecord(cvars, engine)).toEqual({ kind: 'unavailable' })
      expect(applyAutorecord(cvars, engine, false)).toEqual(cvars)
      expect(applyAutorecord({}, engine, true)).toEqual({})
    }
  })

  it("each engine's recipe produces a name its 139 pattern parses", () => {
    for (const engine of ['r1q2', 'q2pro'] as const) {
      expect(SHIPPED_NAME_PATTERNS.some((p) => p.id === AUTORECORD_RECIPES[engine].patternId)).toBe(
        true,
      )
    }
    const q2proName = `${COMMAND.replace('record ', '')
      .replace('${cl_mapname}', 'q2dm1')
      .replace('${com_date}', '2026-09-27')
      .replace('${com_time}', '21-30-00')}.dm2`
    expect(q2proName).toBe('q2dm1_2026-09-27_21-30-00.dm2')
    const q2pro = parseDemoName(q2proName, SHIPPED_NAME_PATTERNS)
    expect(q2pro).toMatchObject({ status: 'matched', patternId: AUTORECORD_RECIPES.q2pro.patternId })
    if (q2pro.status === 'matched') {
      expect(q2pro.facts.map).toBe('q2dm1')
      expect(q2pro.facts.date).toMatchObject({ year: 2026, month: 9, day: 27 })
    }

    const r1q2 = parseDemoName('2026-09-27-2130-q2dm1.dm2', SHIPPED_NAME_PATTERNS)
    expect(r1q2).toMatchObject({ status: 'matched', patternId: AUTORECORD_RECIPES.r1q2.patternId })
    if (r1q2.status === 'matched') {
      expect(r1q2.facts.map).toBe('q2dm1')
      expect(r1q2.facts.date).toMatchObject({ year: 2026, month: 9, day: 27 })
    }
  })
})

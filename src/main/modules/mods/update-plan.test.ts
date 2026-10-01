import { describe, expect, it } from 'vitest'
import { planModUpdate } from './update-plan'

const f = (path: string, sha256 = 'aa') => ({ path, sizeBytes: 1, sha256 })

describe('planModUpdate', () => {
  it('a file only in the old record is deleted, a file in neither record is never listed', () => {
    const plan = planModUpdate(
      { files: [f('old.pak'), f('both.pak')] },
      [f('both.pak'), f('new.pak')],
      new Map([
        ['both.pak', 'aa'],
        ['old.pak', 'aa'],
        ['users.cfg', 'zz'],
      ]),
      'overwrite',
    )
    expect(plan.deleteObsolete).toEqual(['old.pak'])
    expect([...plan.write].sort()).toEqual(['both.pak', 'new.pak'])
    expect(plan.changed).toEqual([])
    const all = [...plan.write, ...plan.deleteObsolete, ...plan.changed, ...plan.keptUntouched]
    expect(all).not.toContain('users.cfg')
  })

  it('keep leaves changed files untouched and out of the new record', () => {
    const old = { files: [f('edited.cfg'), f('gone.cfg'), f('same.pak')] }
    const disk = new Map([
      ['edited.cfg', 'bb'],
      ['gone.cfg', 'bb'],
      ['same.pak', 'aa'],
    ])
    const next = [f('edited.cfg'), f('same.pak')]

    const keep = planModUpdate(old, next, disk, 'keep')
    expect([...keep.changed].sort()).toEqual(['edited.cfg', 'gone.cfg'])
    expect([...keep.keptUntouched].sort()).toEqual(['edited.cfg', 'gone.cfg'])
    expect(keep.write).toEqual(['same.pak'])
    expect(keep.deleteObsolete).toEqual([])

    const overwrite = planModUpdate(old, next, disk, 'overwrite')
    expect(overwrite.keptUntouched).toEqual([])
    expect([...overwrite.write].sort()).toEqual(['edited.cfg', 'same.pak'])
    expect(overwrite.deleteObsolete).toEqual(['gone.cfg'])
  })

  it('a recorded file missing on disk is not changed', () => {
    const plan = planModUpdate({ files: [f('a.pak')] }, [f('a.pak')], new Map(), 'keep')
    expect(plan.changed).toEqual([])
    expect(plan.write).toEqual(['a.pak'])
  })
})

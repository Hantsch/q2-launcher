import { describe, expect, it } from 'vitest'
import { playbackChannelPlan } from './plan'

describe('playbackChannelPlan', () => {
  it('r1q2 plays engine-less, q2pro on win32 starts early over the Windows channel, q2pro elsewhere talks over the pipes', () => {
    const engineLess = { kind: 'engine-less', startsEarly: false, usesPipes: false }
    expect(playbackChannelPlan('win32', 'r1q2')).toEqual(engineLess)
    expect(playbackChannelPlan('linux', 'r1q2')).toEqual(engineLess)
    expect(playbackChannelPlan('win32', 'q2pro')).toEqual({
      kind: 'windows',
      startsEarly: true,
      usesPipes: false,
    })
    for (const platform of ['linux', 'darwin']) {
      expect(playbackChannelPlan(platform, 'q2pro')).toEqual({
        kind: 'pipes',
        startsEarly: false,
        usesPipes: true,
      })
    }
  })
})

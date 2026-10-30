import { describe, expect, test } from 'vitest'
import { advisoryLines } from './linux-advisory.mjs'

const steps = (outcomes) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(outcomes).map(([id, outcome]) => [
        id,
        { outcome, conclusion: outcome === 'skipped' ? 'skipped' : 'success', outputs: {} },
      ]),
    ),
  )

describe('linux advisory', () => {
  test('every failed step is named in a warning and a clean run prints nothing', () => {
    expect(
      advisoryLines(
        'linux.yml/journey',
        steps({ checkout: 'success', build: 'failure', flow: 'skipped', upload: 'failure' }),
      ),
    ).toEqual([
      '::warning::Linux check linux.yml/journey failed: build',
      '::warning::Linux check linux.yml/journey failed: upload',
    ])
    expect(
      advisoryLines('linux.yml/unit', steps({ checkout: 'success', test: 'success' })),
    ).toEqual([])
  })
})

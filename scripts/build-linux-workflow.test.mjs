import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { buildLinuxWorkflowText } from './lib/build-linux-workflow.mjs'

const SHA = 'a'.repeat(40)
const release = readFileSync('.github/workflows/release.yml', 'utf-8')

describe('buildLinuxWorkflowText', () => {
  test('substitutes the planned version and the checked sha; no needs. is left', () => {
    const text = buildLinuxWorkflowText(release, '9.9.9', SHA)
    expect(text).toContain(`GUARDED_SHA: ${SHA}`)
    expect(text).toContain('release/9.9.9/')
    expect(text).not.toContain('needs.')
  })

  test('any other needs. reference still throws', () => {
    const other = release.replace('needs.plan.outputs.sha', 'needs.plan.outputs.other')
    expect(() => buildLinuxWorkflowText(other, '9.9.9', SHA)).toThrow(/besides the version and sha/)
  })
})

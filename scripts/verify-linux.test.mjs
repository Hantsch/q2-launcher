import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, test } from 'vitest'
import { linuxRuns, preflight, verdict } from './lib/verify-linux.mjs'

const WORKFLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.github/workflows')

const loadWorkflows = () =>
  readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith('.yml'))
    .map((file) => ({ file, doc: yaml.load(readFileSync(join(WORKFLOWS_DIR, file), 'utf-8')) }))

const ids = (runs) => runs.map(({ workflow, job }) => `${workflow} ${job}`).sort()

describe('verify:linux', () => {
  test('verify:linux runs every Linux job of the workflows and the AppImage build', () => {
    expect(ids(linuxRuns(loadWorkflows()))).toEqual(
      [
        'linux.yml unit',
        'linux.yml journey',
        'linux.yml flows',
        'linux-verify.yml verify',
        'linux-update.yml update',
        'release.yml build-linux',
      ].sort(),
    )
  })

  test('a failed or skipped Linux check is a warning and exits 0', () => {
    const { lines, exitCode } = verdict([
      { workflow: 'linux.yml', job: 'unit', status: 'passed' },
      { workflow: 'linux.yml', job: 'flows', status: 'failed', reason: 'failed: act exited 1' },
      {
        workflow: 'release.yml',
        job: 'build-linux',
        status: 'skipped',
        reason: 'skipped: no plan',
      },
    ])
    expect(lines).toEqual([
      'verify:linux: YELLOW',
      'warning: linux.yml flows: failed: act exited 1',
      'warning: release.yml build-linux: skipped: no plan',
    ])
    expect(exitCode).toBe(0)
    expect(verdict([{ workflow: 'linux.yml', job: 'unit', status: 'passed' }])).toEqual({
      lines: ['verify:linux: GREEN'],
      exitCode: 0,
    })
  })

  test('missing act or Docker is the only non-zero exit', () => {
    expect(preflight({ act: null, docker: true })).toMatch(/act not found/)
    expect(preflight({ act: 'act', docker: false })).toMatch(/Docker is not running/)
    expect(preflight({ act: 'act', docker: true })).toBeNull()
  })
})

import { describe, expect, test } from 'vitest'
import { decideCiGuard, resolveGuardTarget } from './ci-guard.mjs'
import { releaseCommitMessage } from './plan.mjs'

const run = (head_sha, status, conclusion) => ({ head_sha, status, conclusion })

describe('release ci guard', () => {
  test('a feature commit without a successful ci run is refused', () => {
    const targetSha = resolveGuardTarget({
      headSha: 'feat1',
      headMessage: 'add a thing',
      parentSha: 'parent1',
    })
    const failed = decideCiGuard({
      dryRun: false,
      override: false,
      targetSha,
      runs: [run('parent1', 'completed', 'success'), run('feat1', 'completed', 'failure')],
    })
    expect(targetSha).toBe('feat1')
    expect(failed.pass).toBe(false)
    expect(failed.reason).toBe('no successful ci run for feat1')
    expect(decideCiGuard({ dryRun: false, override: false, targetSha, runs: [] }).pass).toBe(false)
  })

  test('an in-progress ci run is refused at once', () => {
    const decision = decideCiGuard({
      dryRun: false,
      override: false,
      targetSha: 'abc',
      runs: [run('abc', 'in_progress', null)],
    })
    expect(decision.pass).toBe(false)
    expect(decision.reason).toContain('dispatch release again')
  })

  test('a release commit is judged by its parent\'s ci run', () => {
    const targetSha = resolveGuardTarget({
      headSha: 'rel1',
      headMessage: releaseCommitMessage('1.0.1'),
      parentSha: 'parent1',
    })
    expect(targetSha).toBe('parent1')
    const decision = decideCiGuard({
      dryRun: false,
      override: false,
      targetSha,
      runs: [run('parent1', 'completed', 'success')],
    })
    expect(decision.pass).toBe(true)
  })

  test('a dry run passes without any ci run', () => {
    const decision = decideCiGuard({ dryRun: true, override: false, targetSha: 'abc', runs: [] })
    expect(decision).toEqual({ pass: true, reason: 'dry run, guard not applied' })
  })

  test('the override passes without any ci run and says the guard was skipped', () => {
    const decision = decideCiGuard({ dryRun: false, override: true, targetSha: 'abc', runs: [] })
    expect(decision.pass).toBe(true)
    expect(decision.reason).toContain('skipped')
  })
})

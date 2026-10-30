import { describe, expect, it } from 'vitest'
import { isTestFile, listSourceFiles, readRepoFile } from './test-support/source-tree'

/** Size and shape limits on renderer files that tend to regrow; each limit names its file. */
describe('renderer health', () => {
  it('ServersView.tsx stays under 350 lines', () => {
    const source = readRepoFile('src/renderer/src/modules/servers/ServersView.tsx')
    expect(source.split('\n').length).toBeLessThan(350)
  })

  it('hand-rolled cancellation flags stay within budget', () => {
    const flag =
      /let (cancelled|stale|ignore|disposed|alive|active|mounted|aborted)\s*=\s*(true|false)/g
    const count = listSourceFiles('src/renderer/src')
      .filter((file) => !isTestFile(file))
      .reduce((sum, file) => sum + (readRepoFile(file).match(flag)?.length ?? 0), 0)
    expect(count).toBeLessThanOrEqual(9)
  })
})

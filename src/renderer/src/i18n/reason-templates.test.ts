import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sourceFiles } from '../../../test-support/source-files'

describe('reason template guard', () => {
  it('no renderer file builds an i18n key from a reason', () => {
    const root = join(process.cwd(), 'src', 'renderer', 'src')
    const hits = sourceFiles(root)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .flatMap((line, index) =>
            /\.\$\{[\w.]*reason\}/.test(line) ? [`${relative(root, file)}:${index + 1}`] : [],
          ),
      )
    expect(hits, `reason-templated keys: ${hits.join(', ')}`).toEqual([])
  })
})

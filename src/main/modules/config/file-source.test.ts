import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collidingAliasNameProfile, holdLayerProfile } from '@shared/config/fixtures/profiles'
import { renderProfileFile } from '@shared/config/render'
import { writeCanonicalProfileFile } from './canonical'
import { hashCanonicalFileContent, readFileState } from './file-source'

/**
 * Every path below is built from `dir`, a throwaway temp directory created per test - same
 * convention as `canonical.test.ts`, this suite writes real files too.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-file-source-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readFileState', () => {
  it('reports missing for a file that does not exist', async () => {
    const result = await readFileState(dir, 'nope.cfg', undefined)
    expect(result).toEqual({ state: 'missing' })
  })

  it('reports readError - not missing - for a read failure that is not ENOENT', async () => {
    // A directory sitting where a file should be: `readFile` fails with EISDIR, never ENOENT, so
    // this must land in `readError`, not be folded into `missing` the way an unreadable-for-any-
    // reason file would if the two were conflated (see `readFileState`'s own doc comment on why
    // that distinction matters).
    await mkdir(join(dir, 'p.cfg'))

    const result = await readFileState(dir, 'p.cfg', undefined)

    expect(result.state).toBe('readError')
  })

  it('reports changedOnDisk with no cached hash at all (no baseline yet)', async () => {
    await writeFile(join(dir, 'p.cfg'), 'set sensitivity "3"\n', 'latin1')

    const result = await readFileState(dir, 'p.cfg', undefined)

    expect(result.state).toBe('changedOnDisk')
    if (result.state === 'changedOnDisk') {
      expect(result.profile.cvars).toEqual({ sensitivity: '3' })
      expect(typeof result.hash).toBe('string')
    }
  })

  it('reports changedOnDisk when the cached hash does not match the file on disk', async () => {
    await writeFile(join(dir, 'p.cfg'), 'set sensitivity "3"\n', 'latin1')

    const result = await readFileState(dir, 'p.cfg', 'not-the-real-hash')

    expect(result.state).toBe('changedOnDisk')
  })

  it('applies unbind/unbindall folding before handing binds to the parsed profile', async () => {
    await writeFile(
      join(dir, 'p.cfg'),
      ['bind w "+forward"', 'bind s "+back"', 'unbind w', 'bind x "+moveleft"', 'unbindall', 'bind y "+moveright"'].join(
        '\n',
      ),
      'latin1',
    )

    const result = await readFileState(dir, 'p.cfg', undefined)

    expect(result.state).toBe('changedOnDisk')
    if (result.state === 'changedOnDisk') {
      // `unbind w` removed w, then `unbindall` cleared everything accumulated before it - only the
      // last bind, made after that unbindall, survives.
      expect(result.profile.binds).toEqual({ y: '+moveright' })
    }
  })

  // ---------------------------------------------------------------------------
  // Story-050 review, finding 4 (second round): the `alias` fold is where a
  // whole entry can disappear, so the fold is what has to say so. Driven through
  // the real writer rather than a hand-typed file, because the point of the
  // finding was that the previous fix's test fed an input no reader can produce.
  // ---------------------------------------------------------------------------

  it('reports entry-alias-duplicate for a definition its own alias fold discards', async () => {
    // `Fire` and `fire!` in one category both derive the alias name `fire`, so the writer emits
    // `alias fire` twice - see `collidingAliasNameProfile`. Everything below is the real pipeline:
    // `renderProfileFile` writes it, `readFileState` reads it back.
    const text = renderProfileFile(collidingAliasNameProfile)
    expect(text.match(/^alias fire /gm)).toHaveLength(2)
    await writeFile(join(dir, 'p.cfg'), Buffer.from(text, 'latin1'))

    const result = await readFileState(dir, 'p.cfg', undefined)

    expect(result.state).toBe('changedOnDisk')
    if (result.state !== 'changedOnDisk') return

    const duplicates = result.profile.warnings.filter(
      (warning) => warning.reason === 'entry-alias-duplicate',
    )
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.subject).toBe('fire')
    expect(duplicates[0]?.file).toBe('p.cfg')
    // The *discarded* line - the one whose body did not survive the read - identified by finding
    // `alias fire use blaster` in the very text that was written, so this cannot drift with the
    // header block's length.
    const discardedLine =
      text.split('\n').findIndex((line) => line.startsWith('alias fire use blaster')) + 1
    expect(discardedLine).toBeGreaterThan(0)
    expect(duplicates[0]?.line).toBe(discardedLine)

    // And the loss the warning is about is real: one entry, carrying the surviving body, with both
    // keys folded onto it. Asserted so the warning can never be "fixed" by making it fire on a file
    // that lost nothing.
    expect(result.profile.actions).toHaveLength(1)
    expect(result.profile.actions[0]?.commands).toEqual([{ kind: 'raw', text: 'use railgun' }])
  })

  it('reports no entry-alias-duplicate for a healthy launcher-written file', async () => {
    // The false-positive guard: the fold reports every re-defined alias name in the file, layer and
    // chunk aliases included, so a fixture that emits a full hold layer must stay silent.
    const text = renderProfileFile(holdLayerProfile)
    await writeFile(join(dir, 'p.cfg'), Buffer.from(text, 'latin1'))

    const result = await readFileState(dir, 'p.cfg', undefined)

    expect(result.state).toBe('changedOnDisk')
    if (result.state !== 'changedOnDisk') return
    expect(
      result.profile.warnings.filter((warning) => warning.reason === 'entry-alias-duplicate'),
    ).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Hash-baseline acceptance: a write seeds the baseline, so the launcher's own
  // write is never mistaken for an external edit.
  // ---------------------------------------------------------------------------

  it('reports unchanged when the cached hash is the hash of what writeCanonicalProfileFile just wrote', async () => {
    const { path } = await writeCanonicalProfileFile(dir, holdLayerProfile, 'p.cfg')
    const written = await readFile(path, 'latin1')
    const cachedHash = hashCanonicalFileContent(written)

    const result = await readFileState(dir, 'p.cfg', cachedHash)

    expect(result.state).toBe('unchanged')
    if (result.state === 'unchanged') {
      expect(result.hash).toBe(cachedHash)
      expect(result.profile.actions.length).toBeGreaterThan(0)
    }
  })

  it('reports changedOnDisk once the file is edited after that same baseline', async () => {
    const { path } = await writeCanonicalProfileFile(dir, holdLayerProfile, 'p.cfg')
    const written = await readFile(path, 'latin1')
    const cachedHash = hashCanonicalFileContent(written)

    await writeFile(path, `${written}\nset newcvar "1"\n`, 'latin1')

    const result = await readFileState(dir, 'p.cfg', cachedHash)

    expect(result.state).toBe('changedOnDisk')
  })

  // ---------------------------------------------------------------------------
  // Story 043 D10: content that is not text at all is `unparseable`, with a real
  // line - the branch that used to be documented as unreachable, and the reason
  // AC4's "an unparseable file does not take the profile down" is now true rather
  // than resting on a parser that never throws.
  // ---------------------------------------------------------------------------

  it('reports a NUL-truncated file as unparseable, naming the line the corruption starts on', async () => {
    const good = renderProfileFile(holdLayerProfile)
    const cut = good.indexOf('\n', good.indexOf('\n') + 1) + 5
    const truncated = `${good.slice(0, cut)}${String.fromCharCode(0).repeat(32)}`
    await writeFile(join(dir, 'p.cfg'), Buffer.from(truncated, 'latin1'))

    const result = await readFileState(dir, 'p.cfg', undefined)

    expect(result.state).toBe('unparseable')
    if (result.state === 'unparseable') {
      expect(result.file).toBe('p.cfg')
      // The third line is where the NUL run starts - a real position, not the `line: 1` placeholder
      // the thrown-error branch has to fall back to.
      expect(result.line).toBe(3)
      expect(result.message).toContain('0x00')
    }
  })

  it('reports a file of binary garbage as unparseable rather than parsing it into an empty profile', async () => {
    const garbage = Buffer.from(
      Array.from({ length: 256 }, (_value, index) => (index * 7) % 32),
    )
    await writeFile(join(dir, 'p.cfg'), garbage)

    const result = await readFileState(dir, 'p.cfg', undefined)

    expect(result.state).toBe('unparseable')
  })

  it('leaves genuinely textual damage on the degrade path: an unterminated quote, CRLF and an empty file are all changedOnDisk', async () => {
    const good = renderProfileFile(holdLayerProfile)
    const cases: Record<string, string> = {
      'unterminated.cfg': good.replace(/"([^"\n]*)"/, '"$1'),
      'crlf.cfg': good.replace(/\n/g, '\r\n'),
      'empty.cfg': '',
      // A tab and a DOS end-of-file marker are the two sub-space bytes a text editor really does
      // write, so neither may be mistaken for corruption.
      'tabs.cfg': `${good}\t// hand-added\n${String.fromCharCode(26)}`,
    }

    for (const [name, content] of Object.entries(cases)) {
      await writeFile(join(dir, name), Buffer.from(content, 'latin1'))
      const result = await readFileState(dir, name, undefined)
      expect(result.state, `${name} must stay on the degrade path`).toBe('changedOnDisk')
    }
  })

  // ---------------------------------------------------------------------------
  // A hand-deleted metadata comment degrades gracefully (042's own rule) rather
  // than making the file unparseable.
  // ---------------------------------------------------------------------------

  it('parses a file with a hand-deleted [q2l cat=...] tag as changedOnDisk, not unparseable', async () => {
    const rendered = renderProfileFile(holdLayerProfile)
    expect(rendered).toContain('[q2l cat=')

    // Simulate a user editing the file in Notepad and stripping the category tag out of every
    // section header that carries one (the "Aliases:" and "Binds:" headers for the same category
    // both render `[q2l cat=drops]`, so a single non-global replace would silently leave one
    // intact and understate what this test means to exercise), leaving every other tag - the
    // header's own `[q2l v=...]` marker, the entry/layer tags - untouched.
    const mangled = rendered.replace(/\[q2l cat=[^\]]*\]/g, '')
    expect(mangled).not.toContain('[q2l cat=')
    expect(mangled).toContain('[q2l v=')
    await writeFile(join(dir, 'p.cfg'), mangled, 'latin1')

    const result = await readFileState(dir, 'p.cfg', undefined)

    expect(result.state).toBe('changedOnDisk')
    if (result.state === 'changedOnDisk') {
      // The entry itself still comes back - only its category attribution degraded - which is
      // exactly the "config line wins, degrade rather than fail" rule this test is pinning.
      expect(result.profile.actions.length).toBeGreaterThan(0)
    }
  })
})

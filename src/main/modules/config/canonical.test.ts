import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { renderProfileFile, sentinelLine } from '@shared/config/render'
import { pathExists } from '../../lib/fs-utils'
import { BACKUP_SUFFIX } from './backup'
import { removeCanonicalProfileFile, writeCanonicalProfileFile } from './canonical'

const HAND_WRITTEN = 'bind mouse2 "+attack"\nset name "player"\n'

/**
 * Every path below is built from `dir`, a throwaway temp directory created
 * per test - this suite writes real files, so it must never be able to touch
 * anything outside it.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-canonical-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: { sensitivity: '3' },
    binds: {},
    assignments: [],
    ...overrides,
  }
}

function read(...segments: string[]): Promise<string> {
  return readFile(join(dir, ...segments), 'latin1')
}

async function seed(relativePath: string, content: string): Promise<void> {
  const target = join(dir, relativePath)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'latin1')
}

describe('writeCanonicalProfileFile', () => {
  it('creates the file with the rendered content when nothing exists yet', async () => {
    const p = profile()
    const result = await writeCanonicalProfileFile(dir, p, 'p1.cfg')

    expect(result.outcome).toBe('written')
    expect(result.path).toBe(join(dir, 'p1.cfg'))
    expect(await read('p1.cfg')).toBe(renderProfileFile(p))
  })

  it('is a diff-skip when writing the same unchanged profile again', async () => {
    const p = profile()
    await writeCanonicalProfileFile(dir, p, 'p1.cfg')

    const result = await writeCanonicalProfileFile(dir, p, 'p1.cfg')

    expect(result.outcome).toBe('unchanged')
    expect(await pathExists(join(dir, `p1.cfg${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('moves the file to the new name on a rename instead of duplicating it', async () => {
    const p = profile()
    await writeCanonicalProfileFile(dir, p, 'Old.cfg')

    const result = await writeCanonicalProfileFile(dir, p, 'New.cfg')

    // The content itself did not change, only its file name - the move
    // already lands byte-identical content at the new path, so the follow-up
    // writeTargetFile call correctly diff-skips rather than rewriting.
    expect(result.outcome).toBe('unchanged')
    expect(await pathExists(join(dir, 'Old.cfg'))).toBe(false)
    expect(await read('New.cfg')).toBe(renderProfileFile(p))
    expect(await pathExists(join(dir, `Old.cfg${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('backs up a foreign file sitting at the rename destination before replacing it', async () => {
    // Review finding: a rename's destination is not guaranteed to be empty -
    // the user may have their own hand-written file already sitting under
    // the profile's new name. `rename()` replaces a destination
    // unconditionally, so it must be backed up first, same as a plain write.
    const p = profile()
    await writeCanonicalProfileFile(dir, p, 'Old.cfg')
    await seed('New.cfg', HAND_WRITTEN)

    const result = await writeCanonicalProfileFile(dir, p, 'New.cfg')

    expect(result.outcome).toBe('unchanged')
    expect(await pathExists(join(dir, 'Old.cfg'))).toBe(false)
    expect(await read('New.cfg')).toBe(renderProfileFile(p))
    expect(await read(`New.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
  })

  it('does not back up a rename destination that already carries launcher-owned content', async () => {
    // A destination already carrying OWNERSHIP_MARKER - even stale output for
    // a DIFFERENT profile, which `resolveProfileFileNames` is what prevents in
    // practice, not this function - is never worth backing up.
    const p = profile()
    await writeCanonicalProfileFile(dir, p, 'Old.cfg')
    await seed('New.cfg', `${sentinelLine('some-other-profile')}\nset x "1"\n`)

    const result = await writeCanonicalProfileFile(dir, p, 'New.cfg')

    // The rename moved byte-identical content onto the destination, so the
    // follow-up `writeTargetFile` call diff-skips.
    expect(result.outcome).toBe('unchanged')
    expect(await read('New.cfg')).toBe(renderProfileFile(p))
    expect(await pathExists(join(dir, `New.cfg${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('refuses to rename over a file that belongs to another live profile', async () => {
    // Review finding, the hardening half: `resolveProfileFileNames` prevents
    // two profiles from RESOLVING to the same name, but says nothing about
    // what is still on disk from before this sync ran. A destination holding
    // a live profile's own canonical file must be refused, never replaced.
    const p = profile({ id: 'p1' })
    await writeCanonicalProfileFile(dir, p, 'Frag.cfg')
    const otherContent = `${sentinelLine('p2')}\nset x "1"\n`
    await seed('Duel.cfg', otherContent)

    await expect(
      writeCanonicalProfileFile(dir, p, 'Duel.cfg', new Set(['p1', 'p2'])),
    ).rejects.toThrow(/p2/)

    // Nothing moved: the other profile's file is untouched and this profile's
    // own file is still where it was.
    expect(await read('Duel.cfg')).toBe(otherContent)
    expect(await read('Frag.cfg')).toBe(renderProfileFile(p))
    expect(await pathExists(join(dir, `Duel.cfg${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('refuses to write over another live profile file even when it has no file of its own yet', async () => {
    const p = profile({ id: 'p1' })
    const otherContent = `${sentinelLine('p2')}\nset x "1"\n`
    await seed('Duel.cfg', otherContent)

    await expect(
      writeCanonicalProfileFile(dir, p, 'Duel.cfg', new Set(['p1', 'p2'])),
    ).rejects.toThrow(/p2/)

    expect(await read('Duel.cfg')).toBe(otherContent)
  })

  it('still replaces launcher-owned output whose profile no longer exists', async () => {
    // The refusal is about LIVE profiles only - stale output for a profile
    // that is gone would otherwise block the name forever.
    const p = profile({ id: 'p1' })
    await writeCanonicalProfileFile(dir, p, 'Frag.cfg')
    await seed('Duel.cfg', `${sentinelLine('deleted-profile')}\nset x "1"\n`)

    const result = await writeCanonicalProfileFile(dir, p, 'Duel.cfg', new Set(['p1']))

    expect(result.outcome).toBe('unchanged')
    expect(await read('Duel.cfg')).toBe(renderProfileFile(p))
    expect(await pathExists(join(dir, 'Frag.cfg'))).toBe(false)
  })

  it('backs up a foreign file once before overwriting it on the first write', async () => {
    await seed('p1.cfg', HAND_WRITTEN)
    const p = profile()

    const result = await writeCanonicalProfileFile(dir, p, 'p1.cfg')

    expect(result.outcome).toBe('written')
    expect(await read(`p1.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    expect(await read('p1.cfg')).toBe(renderProfileFile(p))
  })

  it('creates baseDir itself when it does not exist yet', async () => {
    const fresh = join(dir, 'userData')
    const p = profile()

    const result = await writeCanonicalProfileFile(fresh, p, 'p1.cfg')

    expect(result.outcome).toBe('written')
    expect(await readFile(join(fresh, 'p1.cfg'), 'latin1')).toBe(renderProfileFile(p))
  })
})

describe('removeCanonicalProfileFile', () => {
  it('deletes the canonical file of a profile that has one', async () => {
    const p = profile()
    await writeCanonicalProfileFile(dir, p, 'p1.cfg')

    await removeCanonicalProfileFile(dir, p.id)

    expect(await pathExists(join(dir, 'p1.cfg'))).toBe(false)
  })

  it('is a no-op when baseDir does not exist at all', async () => {
    const missing = join(dir, 'does-not-exist')

    await expect(removeCanonicalProfileFile(missing, 'p1')).resolves.toBeUndefined()
  })

  it('is a no-op when no file in baseDir matches the profile', async () => {
    await seed('unrelated.cfg', HAND_WRITTEN)

    await expect(removeCanonicalProfileFile(dir, 'p1')).resolves.toBeUndefined()
    expect(await pathExists(join(dir, 'unrelated.cfg'))).toBe(true)
  })

  it('never touches a different profile own canonical file', async () => {
    const other = profile({ id: 'p2' })
    await writeCanonicalProfileFile(dir, other, 'p2.cfg')

    await removeCanonicalProfileFile(dir, 'p1')

    expect(await pathExists(join(dir, 'p2.cfg'))).toBe(true)
  })
})

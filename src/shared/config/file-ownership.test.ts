import { describe, expect, it } from 'vitest'
import { OWNERSHIP_MARKER, sentinelLine } from '@shared/config/render'
import { formatMetaTag } from '@shared/config/profile-metadata'
import { HEADER_SCAN_LINES, isLauncherOwnedFile, readOwnershipStamp } from './file-ownership'

const PROFILE_ID = 'a1b2c3d4-e5f6-4789-0000-111122223333'
const PROFILE_NAME = 'My Profile'

/** The story-051 banner shape: a `=` rule, the name, another `=` rule, and the header tag alone
 * on the last `//` line - built here rather than imported from a writer, since D2 (the writer that
 * renders this shape) is a later deliverable this story explicitly defers. */
function bannerHeader(id: string): string {
  const rule = `// ${'='.repeat(40)}`
  const tag = formatMetaTag({ v: '1', id })
  return [rule, `// ${PROFILE_NAME}`, rule, `// ${tag}`].join('\n')
}

function sentinelHeader(id: string): string {
  return sentinelLine(id)
}

describe('readOwnershipStamp', () => {
  it('reads the same id from a banner-shaped header', () => {
    const text = `${bannerHeader(PROFILE_ID)}\nset name "${PROFILE_NAME}"\n`
    expect(readOwnershipStamp(text)).toEqual({ id: PROFILE_ID, version: '1', shape: 'banner' })
  })

  it('reads the same id from a legacy sentinel-shaped header', () => {
    const text = `${sentinelHeader(PROFILE_ID)}\nexec q2l-profile-${PROFILE_ID}.cfg\n`
    expect(readOwnershipStamp(text)).toEqual({ id: PROFILE_ID, version: '', shape: 'sentinel' })
  })

  it('yields the same { id } for the same profile from both shapes', () => {
    const banner = readOwnershipStamp(`${bannerHeader(PROFILE_ID)}\n`)
    const sentinel = readOwnershipStamp(`${sentinelHeader(PROFILE_ID)}\n`)
    expect(banner?.id).toBe(PROFILE_ID)
    expect(sentinel?.id).toBe(PROFILE_ID)
    expect(banner?.id).toBe(sentinel?.id)
  })

  it('returns null for an id-less tag (v alone, no id)', () => {
    const text = `// ${formatMetaTag({ v: '1' })}\nset name "x"\n`
    expect(readOwnershipStamp(text)).toBeNull()
  })

  it('returns null for a malformed tag', () => {
    const text = '// something [q2l id=abc\nset name "x"\n'
    expect(readOwnershipStamp(text)).toBeNull()
  })

  it('returns null for a sentinel-prefix line not followed by whitespace+id', () => {
    // "// q2-launcher profiles" is a different word, not OWNERSHIP_MARKER plus an id.
    const text = `${OWNERSHIP_MARKER}s are documented in the manual\nset x "1"\n`
    expect(readOwnershipStamp(text)).toBeNull()
  })

  it('returns null for an empty sentinel with no id token after it', () => {
    expect(readOwnershipStamp(`${OWNERSHIP_MARKER}\nset x "1"\n`)).toBeNull()
  })

  it('returns null for a wholly foreign config (dm.cfg-shaped, no ownership stamp at all)', () => {
    // Equivalent in shape to docs/fixtures/dm.cfg's own head: unbindall, blank lines, and a
    // decorated section banner with no [q2l tag and no OWNERSHIP_MARKER anywhere near the top.
    const foreign = [
      'unbindall',
      '',
      'm_filter 1',
      '',
      ' //-----------------------------------------------------------------------------\\\\',
      '<<--------------------------- .: General Settings :. ----------------------------->>',
      ' \\\\-----------------------------------------------------------------------------//',
      'set name "sd.kgm/sauDove"',
    ].join('\n')
    expect(readOwnershipStamp(foreign)).toBeNull()
  })

  it('does not treat a [q2l id=…] tag appearing after HEADER_SCAN_LINES as ownership', () => {
    const filler = Array.from({ length: HEADER_SCAN_LINES }, (_, i) => `// filler line ${i}`)
    const lateTag = `// ${formatMetaTag({ v: '1', id: PROFILE_ID })}`
    const text = [...filler, lateTag, 'set x "1"'].join('\n')

    expect(readOwnershipStamp(text)).toBeNull()
  })

  it('does treat the same tag as ownership when it lands within the scan window', () => {
    const filler = Array.from({ length: HEADER_SCAN_LINES - 1 }, (_, i) => `// filler line ${i}`)
    const tagLine = `// ${formatMetaTag({ v: '1', id: PROFILE_ID })}`
    const text = [...filler, tagLine, 'set x "1"'].join('\n')

    expect(readOwnershipStamp(text)).toEqual({ id: PROFILE_ID, version: '1', shape: 'banner' })
  })
})

describe('isLauncherOwnedFile', () => {
  it('is true for a banner-owned file', () => {
    expect(isLauncherOwnedFile(`${bannerHeader(PROFILE_ID)}\n`)).toBe(true)
  })

  it('is true for a sentinel-owned file', () => {
    expect(isLauncherOwnedFile(`${sentinelHeader(PROFILE_ID)}\n`)).toBe(true)
  })

  it('is false for a foreign config', () => {
    expect(isLauncherOwnedFile('unbindall\nset name "x"\n')).toBe(false)
  })
})

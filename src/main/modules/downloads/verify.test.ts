import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pathExists } from '../../lib/fs-utils'
import { PART_SUFFIX } from './paths'
import { verifyAndPromote } from './verify'

/**
 * Story 071 D2. The size/hash gate on its own, with no network in sight: real files in a real
 * temp directory, real digests from `node:crypto`, so what is asserted is what an outside
 * observer would see on disk - a promoted file or no file at all - and never what the
 * implementation computed internally.
 *
 * Every path is built from `dir`, a throwaway directory per test (same fixture pattern as
 * `src/main/modules/config/writer.test.ts`), because this suite deletes and renames files.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-verify-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const FILE_NAME = 'package.zip'

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Writes `bytes` as the in-flight `.part` file and returns both paths plus the truth about it. */
async function stagePart(bytes: Buffer): Promise<{
  partPath: string
  finalPath: string
  sizeBytes: number
  sha256: string
}> {
  const finalPath = join(dir, FILE_NAME)
  const partPath = `${finalPath}${PART_SUFFIX}`
  await writeFile(partPath, bytes)
  return { partPath, finalPath, sizeBytes: bytes.byteLength, sha256: sha256(bytes) }
}

describe('verifyAndPromote', () => {
  it('promotes a file whose size and SHA256 both match the package', async () => {
    const bytes = randomBytes(4096)
    const staged = await stagePart(bytes)

    const result = await verifyAndPromote({
      partPath: staged.partPath,
      finalPath: staged.finalPath,
      expected: { sizeBytes: staged.sizeBytes, sha256: staged.sha256 },
      actualSha256: staged.sha256,
      receivedBytes: staged.sizeBytes,
    })

    expect(result).toMatchObject({
      ok: true,
      path: staged.finalPath,
      sizeBytes: 4096,
      sha256: staged.sha256,
    })
    // The bytes at the final path are the bytes that were verified, and the unverified name is gone.
    expect(await readFile(staged.finalPath)).toEqual(bytes)
    expect(await pathExists(staged.partPath)).toBe(false)
  })

  it('accepts an uppercase declared digest', async () => {
    const staged = await stagePart(Buffer.from('mixed case hex is still hex'))

    const result = await verifyAndPromote({
      partPath: staged.partPath,
      finalPath: staged.finalPath,
      expected: { sizeBytes: staged.sizeBytes, sha256: staged.sha256.toUpperCase() },
      actualSha256: staged.sha256,
    })

    expect(result.ok).toBe(true)
    expect(await pathExists(staged.finalPath)).toBe(true)
  })

  it('deletes the file and reports a size mismatch, promoting nothing', async () => {
    const bytes = randomBytes(512)
    const staged = await stagePart(bytes)

    const result = await verifyAndPromote({
      partPath: staged.partPath,
      finalPath: staged.finalPath,
      expected: { sizeBytes: 4096, sha256: staged.sha256 },
      actualSha256: staged.sha256,
    })

    expect(result).toMatchObject({
      ok: false,
      key: 'downloads.error.verificationFailed',
      mismatch: 'size',
      deleted: true,
    })
    expect(await pathExists(staged.partPath)).toBe(false)
    expect(await pathExists(staged.finalPath)).toBe(false)
  })

  it('deletes the file and reports a hash mismatch, promoting nothing', async () => {
    const staged = await stagePart(randomBytes(512))

    const result = await verifyAndPromote({
      partPath: staged.partPath,
      finalPath: staged.finalPath,
      expected: { sizeBytes: staged.sizeBytes, sha256: 'b'.repeat(64) },
      actualSha256: staged.sha256,
    })

    expect(result).toMatchObject({
      ok: false,
      key: 'downloads.error.verificationFailed',
      mismatch: 'sha256',
      deleted: true,
    })
    expect(await pathExists(staged.partPath)).toBe(false)
    expect(await pathExists(staged.finalPath)).toBe(false)
  })

  it('reports a short write when fewer bytes landed on disk than were hashed', async () => {
    // The digest and the declared size agree with what the download *thought* it wrote; only the
    // file on disk disagrees. That is the truncated-file case the size check exists for, and it
    // is why the size is read from the filesystem rather than taken from the byte counter.
    const bytes = randomBytes(1024)
    const staged = await stagePart(bytes.subarray(0, 600))

    const result = await verifyAndPromote({
      partPath: staged.partPath,
      finalPath: staged.finalPath,
      expected: { sizeBytes: 1024, sha256: sha256(bytes) },
      actualSha256: sha256(bytes),
      receivedBytes: 1024,
    })

    expect(result).toMatchObject({ ok: false, mismatch: 'short-write', deleted: true })
    expect(await pathExists(staged.partPath)).toBe(false)
    expect(await pathExists(staged.finalPath)).toBe(false)
  })

  it('reports a missing part file instead of throwing', async () => {
    const finalPath = join(dir, FILE_NAME)

    const result = await verifyAndPromote({
      partPath: `${finalPath}${PART_SUFFIX}`,
      finalPath,
      expected: { sizeBytes: 16, sha256: 'c'.repeat(64) },
      actualSha256: 'c'.repeat(64),
    })

    expect(result).toMatchObject({ ok: false, mismatch: 'missing' })
    expect(await pathExists(finalPath)).toBe(false)
  })

  it('refuses a package whose declared digest is not a sha256, even if the actual one equals it', async () => {
    const staged = await stagePart(Buffer.from('nine byte'))

    const result = await verifyAndPromote({
      partPath: staged.partPath,
      finalPath: staged.finalPath,
      expected: { sizeBytes: staged.sizeBytes, sha256: 'not-a-digest' },
      actualSha256: 'not-a-digest',
    })

    expect(result).toMatchObject({ ok: false, mismatch: 'expectation', deleted: true })
    expect(await pathExists(staged.finalPath)).toBe(false)
  })

  it('refuses a package whose declared size is not a byte count', async () => {
    const staged = await stagePart(Buffer.from('nine byte'))

    const result = await verifyAndPromote({
      partPath: staged.partPath,
      finalPath: staged.finalPath,
      expected: { sizeBytes: -1, sha256: staged.sha256 },
      actualSha256: staged.sha256,
    })

    expect(result).toMatchObject({ ok: false, mismatch: 'expectation', deleted: true })
    expect(await pathExists(staged.finalPath)).toBe(false)
  })

  it('replaces an already cached file of the same name', async () => {
    const bytes = randomBytes(256)
    const staged = await stagePart(bytes)
    await writeFile(staged.finalPath, Buffer.from('an older, smaller cached copy'))

    const result = await verifyAndPromote({
      partPath: staged.partPath,
      finalPath: staged.finalPath,
      expected: { sizeBytes: staged.sizeBytes, sha256: staged.sha256 },
      actualSha256: staged.sha256,
    })

    expect(result.ok).toBe(true)
    expect(await readFile(staged.finalPath)).toEqual(bytes)
  })

  it('creates the cache directory when promoting into one that does not exist yet', async () => {
    const bytes = Buffer.from('first ever download')
    const nested = join(dir, 'cache', 'downloads')
    await mkdir(nested, { recursive: true })
    const partPath = join(nested, `${FILE_NAME}${PART_SUFFIX}`)
    await writeFile(partPath, bytes)
    const finalPath = join(dir, 'cache', 'downloads', 'sub', FILE_NAME)

    const result = await verifyAndPromote({
      partPath,
      finalPath,
      expected: { sizeBytes: bytes.byteLength, sha256: sha256(bytes) },
      actualSha256: sha256(bytes),
    })

    expect(result.ok).toBe(true)
    expect(await readFile(finalPath)).toEqual(bytes)
  })
})

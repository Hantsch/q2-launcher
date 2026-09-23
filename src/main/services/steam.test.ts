import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSteamAppId } from './steam'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-steam-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('readSteamAppId', () => {
  it('reads the appid from the manifest whose installdir matches the folder', async () => {
    const steamappsDir = join(dir, 'steamapps')
    const commonDir = join(steamappsDir, 'common')
    const installRoot = join(commonDir, 'Quake 2')
    await mkdir(installRoot, { recursive: true })
    await writeFile(
      join(steamappsDir, 'appmanifest_2320.acf'),
      '"AppState"\n{\n\t"appid"\t\t"2320"\n\t"installdir"\t\t"Quake 2"\n}\n',
      'utf8',
    )

    await expect(readSteamAppId(installRoot)).resolves.toBe('2320')
  })

  it('a folder with no matching manifest has no appid', async () => {
    // Outside steamapps/common entirely.
    const unrelated = join(dir, 'some', 'other', 'path')
    await mkdir(unrelated, { recursive: true })
    await expect(readSteamAppId(unrelated)).resolves.toBeUndefined()

    // Inside steamapps/common, but no manifest's installdir matches.
    const steamappsDir = join(dir, 'steamapps')
    const commonDir = join(steamappsDir, 'common')
    const installRoot = join(commonDir, 'Quake 2')
    await mkdir(installRoot, { recursive: true })
    await writeFile(
      join(steamappsDir, 'appmanifest_1234.acf'),
      '"AppState"\n{\n\t"appid"\t\t"1234"\n\t"installdir"\t\t"Some Other Game"\n}\n',
      'utf8',
    )
    await expect(readSteamAppId(installRoot)).resolves.toBeUndefined()

    // A manifest whose installdir matches but whose appid is not all digits
    // yields no appid at all (D1) - never the scraped value, never a crash.
    const installRoot2 = join(commonDir, 'Weird Game')
    await mkdir(installRoot2, { recursive: true })
    await writeFile(
      join(steamappsDir, 'appmanifest_weird.acf'),
      '"AppState"\n{\n\t"appid"\t\t"not-a-number"\n\t"installdir"\t\t"Weird Game"\n}\n',
      'utf8',
    )
    await expect(readSteamAppId(installRoot2)).resolves.toBeUndefined()

    // Nor does a prototype-key appid slip through.
    const installRoot3 = join(commonDir, 'Proto Game')
    await mkdir(installRoot3, { recursive: true })
    await writeFile(
      join(steamappsDir, 'appmanifest_proto.acf'),
      '"AppState"\n{\n\t"appid"\t\t"__proto__"\n\t"installdir"\t\t"Proto Game"\n}\n',
      'utf8',
    )
    await expect(readSteamAppId(installRoot3)).resolves.toBeUndefined()
  })
})

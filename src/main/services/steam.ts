import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { listDir } from '../lib/fs-utils'

/**
 * Naively scrapes `"key" "value"` pairs out of a Steam VDF-ish manifest, the
 * same approach `steamLibraryRoots()` uses for `libraryfolders.vdf`
 * (`src/main/services/detection/providers.ts`) rather than pulling in a VDF
 * parser for a format this forgiving.
 */
function scrapeVdfPairs(text: string): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const match of text.matchAll(/"([^"]+)"\s+"([^"]*)"/g)) {
    pairs.set(match[1].toLowerCase(), match[2])
  }
  return pairs
}

function sameName(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Recovers the Steam appid an installation was installed under, purely from
 * its path: `installRoot` must sit directly inside a Steam library's
 * `steamapps/common/`. When it does, every `appmanifest_*.acf` sibling of
 * `common` is scraped for its `"appid"`/`"installdir"` pair, and the id whose
 * installdir matches `installRoot`'s folder name is returned.
 *
 * Never throws: a folder outside `steamapps/common`, an unreadable/missing
 * `steamapps` folder, a malformed manifest, a non-digit appid, or no matching
 * installdir all yield `undefined`. Story 104 D1.
 */
export async function readSteamAppId(installRoot: string): Promise<string | undefined> {
  const commonDir = dirname(installRoot)
  const steamappsDir = dirname(commonDir)

  if (basename(commonDir) !== 'common') return undefined
  if (basename(steamappsDir) !== 'steamapps') return undefined

  const installDirName = basename(installRoot)
  const listing = await listDir(steamappsDir)

  for (const file of listing.files) {
    if (!/^appmanifest_.*\.acf$/i.test(file)) continue
    try {
      const text = await readFile(join(steamappsDir, file), 'utf8')
      const pairs = scrapeVdfPairs(text)
      const installDir = pairs.get('installdir')
      const appid = pairs.get('appid')
      // A non-digit appid is treated as no match: the value ends up in a spawned argv and as an
      // object key (`STEAM_APP_CLIENTS[appid]`), so only a plain numeric id is ever returned.
      if (installDir && appid && /^\d+$/.test(appid) && sameName(installDir, installDirName)) {
        return appid
      }
    } catch {
      // A malformed or unreadable manifest is skipped, not fatal.
    }
  }

  return undefined
}

// Story 071 D3: vendors the standalone `7za.exe` (+ its licence) into `resources/bin/`, the
// binary `src/main/modules/downloads/extractor.ts` spawns via `7za-path.ts` and
// `electron-builder.yml`'s `extraResources` ships alongside the packaged app.
// Story 100 D9: added a non-Windows branch that vendors the official 7-Zip Linux console build
// (`7zz`) the same way, so the extractor works on the Linux target `docs/ROADMAP.md` describes.
//
// Run it by hand: `node scripts/fetch-7za.mjs` (or `npm run fetch:7za`, added to package.json).
// Idempotent: exits immediately, doing nothing, if the target binary already exists - so it is
// safe to run on every fresh clone/CI setup without re-downloading.
//
// What it does, on Windows (`process.platform === 'win32'`):
//   1. Downloads the official 7-Zip "extra" package (the standalone-console variant, which needs
//      no companion DLL) for the pinned version below, from the standard www.7-zip.org download
//      location: https://www.7-zip.org/a/7z<version>-extra.7z
//   2. That archive is itself `.7z`-compressed, which is a real chicken-and-egg problem for a
//      from-scratch environment with no 7-Zip installed yet: this script does NOT ship a pure-JS
//      7z decompressor (out of scope for a one-off vendoring script). Instead it looks for an
//      already-installed 7-Zip/7za on the machine (`7z`, `7za`, or the default Windows install
//      path) and shells out to that to extract just `7za.exe` and `License.txt`.
//   3. If no local 7-Zip is found, the downloaded archive is left in place under
//      `resources/bin/.fetch-7za-tmp/` and the script prints the two files to extract by hand
//      (e.g. with 7-Zip File Manager, or any other tool that understands `.7z`) into
//      `resources/bin/`, then exits non-zero. This is expected and acceptable in a sandboxed
//      environment with no network access to 7-zip.org and no 7-Zip installed - see story
//      docs/requirements/071-downloads-are-verified-jobs.md, D3: "acceptable if you cannot
//      actually execute it end-to-end here."
//
// What it does, everywhere else (Linux, and any other non-Windows host):
//   1. Downloads the official 7-Zip Linux x64 console build - a plain `.tar.xz`, not a `.7z` - from
//      the same www.7-zip.org host/path convention as the Windows archive:
//      https://www.7-zip.org/a/7z<version>-linux-x64.tar.xz
//   2. `.tar.xz` has none of the Windows archive's chicken-and-egg problem: every Linux host this
//      launcher targets (including every Linux CI runner) ships a `tar` binary that already
//      understands `-J` (xz), so this shells out to the system `tar -xJf` rather than adding a new
//      npm dependency just to unpack one archive.
//   3. The extracted `7zz` binary is `chmod`-ed executable (tar normally preserves the archive's own
//      permission bits, but this is a cheap belt-and-braces step) and, along with the tarball's
//      `License.txt`, moved into `resources/bin/`.
//
// Network access to www.7-zip.org may not be available in every environment this repo is worked
// in (this script has not been run end-to-end in the sandbox this was authored in, on either
// platform) - that is why `extractor.ts`/`extractor.test.ts` treat a missing binary as
// `downloads.error.extractorMissing` and gate their real-archive test on `existsSync`, rather than
// assuming this script has run.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN_DIR = join(REPO_ROOT, 'resources', 'bin')

const IS_WINDOWS = process.platform === 'win32'
// Story 100 D9: matches `BINARY_NAME` in `src/main/modules/downloads/7za-path.ts` - the two must
// stay in lockstep, since that module is what resolves this file's output at runtime.
const BINARY_NAME = IS_WINDOWS ? '7za.exe' : '7zz'
const TARGET_BINARY = join(BIN_DIR, BINARY_NAME)
const TARGET_LICENSE = join(BIN_DIR, 'License.txt')

// Pinned 7-Zip version (Decisions (Sprint): "7za.exe ... for the current pinned version"). Bump
// deliberately, not automatically - a vendored executable is exactly the kind of dependency that
// should not silently float. The same pin is used for both the Windows and Linux archives.
// Story 074 D8 bumped this from '2409' to '2603': 7-zip.org serves only a handful of
// `7z<version>-extra.7z` archives at a time and had stopped serving 2409 (a plain 404), so the
// pin was unfetchable and D8's end-to-end flow - which needs a real `7za.exe` to extract real
// fixture archives - could not be satisfied at all. Still a deliberate pin, not a floating one.
const SEVEN_ZIP_VERSION = '2603'
const EXTRA_ARCHIVE_URL = `https://www.7-zip.org/a/7z${SEVEN_ZIP_VERSION}-extra.7z`
const LINUX_ARCHIVE_URL = `https://www.7-zip.org/a/7z${SEVEN_ZIP_VERSION}-linux-x64.tar.xz`

const TMP_DIR = join(BIN_DIR, '.fetch-7za-tmp')
const TMP_WINDOWS_ARCHIVE = join(TMP_DIR, `7z${SEVEN_ZIP_VERSION}-extra.7z`)
const TMP_LINUX_ARCHIVE = join(TMP_DIR, `7z${SEVEN_ZIP_VERSION}-linux-x64.tar.xz`)

/** Local 7-Zip binaries this script tries, in order, to extract the downloaded Windows archive with. */
const LOCAL_SEVENZIP_CANDIDATES = [
  '7z',
  '7za',
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
]

function findLocalSevenZip() {
  for (const candidate of LOCAL_SEVENZIP_CANDIDATES) {
    try {
      execFileSync(candidate, ['--help'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Not found / not runnable - try the next candidate.
    }
  }
  return undefined
}

async function downloadFile(url, destination) {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  mkdirSync(TMP_DIR, { recursive: true })
  await writeFile(destination, bytes)
}

async function fetchWindows() {
  console.log(`downloading ${EXTRA_ARCHIVE_URL} ...`)
  await downloadFile(EXTRA_ARCHIVE_URL, TMP_WINDOWS_ARCHIVE)
  console.log(`downloaded to ${TMP_WINDOWS_ARCHIVE}`)

  const sevenZip = findLocalSevenZip()
  if (!sevenZip) {
    console.error(
      [
        '',
        'No local 7-Zip found to extract the downloaded archive (tried: ' +
          LOCAL_SEVENZIP_CANDIDATES.join(', ') +
          ').',
        `The archive is at ${TMP_WINDOWS_ARCHIVE}.`,
        `Extract "7za.exe" and "License.txt" from it into ${BIN_DIR} by hand (e.g. with 7-Zip`,
        'File Manager, or any tool that understands .7z), then re-run this script - it will see',
        `${TARGET_BINARY} already exists and skip re-downloading.`,
        '',
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }

  console.log(`extracting with ${sevenZip} ...`)
  execFileSync(
    sevenZip,
    ['e', TMP_WINDOWS_ARCHIVE, `-o${TMP_DIR}`, '-y', '7za.exe', 'License.txt'],
    { stdio: 'inherit' },
  )

  renameSync(join(TMP_DIR, '7za.exe'), TARGET_BINARY)
  if (existsSync(join(TMP_DIR, 'License.txt'))) {
    renameSync(join(TMP_DIR, 'License.txt'), TARGET_LICENSE)
  }
  rmSync(TMP_DIR, { recursive: true, force: true })
}

async function fetchLinux() {
  console.log(`downloading ${LINUX_ARCHIVE_URL} ...`)
  await downloadFile(LINUX_ARCHIVE_URL, TMP_LINUX_ARCHIVE)
  console.log(`downloaded to ${TMP_LINUX_ARCHIVE}`)

  console.log(`extracting with tar -xJf ...`)
  try {
    execFileSync('tar', ['-xJf', TMP_LINUX_ARCHIVE, '-C', TMP_DIR, '7zz', 'License.txt'], {
      stdio: 'inherit',
    })
  } catch (error) {
    console.error(
      [
        '',
        `Failed to extract ${TMP_LINUX_ARCHIVE} with "tar -xJf" (${error instanceof Error ? error.message : String(error)}).`,
        'This script shells out to the system `tar` binary rather than bundling a decompressor -',
        'it is expected to be preinstalled on every Linux host/CI runner this launcher targets.',
        `Extract "7zz" and "License.txt" from the archive by hand into ${BIN_DIR}, then re-run`,
        `this script - it will see ${TARGET_BINARY} already exists and skip re-downloading.`,
        '',
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }

  renameSync(join(TMP_DIR, '7zz'), TARGET_BINARY)
  chmodSync(TARGET_BINARY, 0o755)
  if (existsSync(join(TMP_DIR, 'License.txt'))) {
    renameSync(join(TMP_DIR, 'License.txt'), TARGET_LICENSE)
  }
  rmSync(TMP_DIR, { recursive: true, force: true })
}

async function main() {
  if (existsSync(TARGET_BINARY)) {
    console.log(`already vendored: ${TARGET_BINARY}`)
    return
  }

  mkdirSync(BIN_DIR, { recursive: true })

  if (IS_WINDOWS) {
    await fetchWindows()
  } else {
    await fetchLinux()
  }

  if (process.exitCode) return
  console.log(`vendored ${TARGET_BINARY}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

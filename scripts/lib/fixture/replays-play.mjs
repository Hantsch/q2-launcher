import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, UI_VERIFY_ROOT } from '../paths.mjs'
import { variantUserDataDir } from '../harness.mjs'
import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import {
  DEFAULT_SETTINGS,
  FIXED_TIMESTAMP,
  STATE_FILE,
  WINDOW_STATE_FILE,
  emptyStateDocument,
  gameRoot,
  rmDirBestEffort,
  windowStateDocument,
  writeJson,
} from './core.mjs'
import { bootstrapStagingDir, vendoredExtractorExists, vendoredSevenZaPath } from './bootstrap.mjs'

// --- story 159 D3: `replays-play` - demos playable in a stand-in Q2PRO ---------------------------
//
// Two registered installations: the ACTIVE `q2pro` one (the same spawnable stand-in client as
// `writeJoinInstallRoot()`, renamed `q2pro.exe`/`q2pro` so it classifies as q2pro; game dirs
// `baseq2` + `ctf`) and a second, plain `r1q2` one. No real engine ever starts: the "client" is
// `scripts/lib/stub-engine.cjs` (story 165 D4, `writeStubEngine()`), which speaks the playback
// transport and exits by itself after 400 ms unless told otherwise. Demos live under the q2pro install:
// `baseq2/demos/play-base.dm2`, `ctf/demos/play-ctf.dm2` (header game dir patched to `ctf`) and
// `baseq2/demos/play-tdm.dm2` (the unpatched fixture, header game dir `opentdm` - a mod no
// installation has, so Play must say "Mod `opentdm` missing").
export const REPLAYS_PLAY_Q2PRO_ID = 'fixture-replays-play-q2pro'

export const REPLAYS_PLAY_R1Q2_ID = 'fixture-replays-play-r1q2'

export const REPLAYS_PLAY_BASE_DEMO = 'play-base.dm2'

export const REPLAYS_PLAY_CTF_DEMO = 'play-ctf.dm2'

export const REPLAYS_PLAY_MISSING_MOD_DEMO = 'play-tdm.dm2'

export const REPLAYS_PLAY_MISSING_MOD = 'opentdm'

/** Returns `test.dm2` with its serverdata block's game dir rewritten to `gameDir` (block 0 =
 * `int32 length`, then `svc_serverdata`: 1 + 4 + 4 + 1 bytes, then the null-terminated game dir). */
function demoBytesWithGameDir(gameDir) {
  const src = readFileSync(join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2'))
  const blockLength = src.readUInt32LE(0)
  const dirStart = 4 + 10
  const dirEnd = src.indexOf(0, dirStart)
  const patched = Buffer.concat([Buffer.from(gameDir, 'latin1'), Buffer.from([0])])
  const out = Buffer.concat([src.subarray(0, dirStart), patched, src.subarray(dirEnd + 1)])
  out.writeUInt32LE(blockLength - (dirEnd + 1 - dirStart) + patched.length, 0)
  return out
}

export function replaysPlayInstallRoot() {
  return join(gameRoot(), 'fixture-replays-play-q2pro-install')
}

/** Every fixture demo derives from `docs/fixtures/demos/test.dm2`: 410 server frames = 41 s. */
export const REPLAYS_PLAY_DEMO_MS = 41_000

/** copyFileSync that waits out a previous run's stub still holding `dest` open (Windows locks it
 * until the stub notices its launcher is gone, see `stub-engine.cjs`'s parent check). */
function copyFileRetrying(src, dest) {
  const deadline = Date.now() + 5_000
  for (;;) {
    try {
      copyFileSync(src, dest)
      return
    } catch (err) {
      if (Date.now() >= deadline || !['EBUSY', 'EPERM'].includes(err?.code)) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
}

/**
 * Story 165 D4: installs `scripts/lib/stub-engine.cjs` - the stand-in Q2PRO that speaks story 164's
 * playback transport - as `executablePath`. Windows: this node binary copied as `q2pro.exe` plus the
 * script as `<root>/+set.js` (node resolves the launch's leading `+set` argument against the cwd, the
 * install root). Elsewhere: a `#!/bin/sh` wrapper that execs node on the script with the real argv.
 * `stub-engine.json` carries the demo length and how long the stub lives when nobody quits it
 * (400 ms by default - the old stand-in's "exits by itself" behaviour the 159-162 flows rely on).
 */
function writeStubEngine(root, executablePath, { lifetimeMs = 400 } = {}) {
  const script = join(REPO_ROOT, 'scripts', 'lib', 'stub-engine.cjs')
  writeJson(join(root, 'stub-engine.json'), { demoMs: REPLAYS_PLAY_DEMO_MS, lifetimeMs })
  if (process.platform === 'win32') {
    copyFileRetrying(script, join(root, '+set.js'))
    copyFileRetrying(process.execPath, executablePath)
    return
  }
  const target = join(root, 'stub-engine.cjs')
  copyFileSync(script, target)
  const quote = (p) => `'${p.replace(/'/g, `'\\''`)}'`
  writeFileSync(
    executablePath,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(target)} "$@"\n`,
  )
  chmodSync(executablePath, 0o755)
}

// Story 180 D4: an optional third installation that lacks pak0.pak (status `invalid`), so the
// action bar's installation-level Repair state can be reached from the Demos tab.
export const REPLAYS_PLAY_BROKEN_ID = 'fixture-replays-play-broken'

export const REPLAYS_PLAY_BROKEN_NAME = 'Fixture Play Broken'

export function writeReplaysPlayFixture(
  variant = 'replays-play',
  { engineLifetimeMs, brokenInstallation = false } = {},
) {
  const userDataDir = variantUserDataDir(variant)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  const root = replaysPlayInstallRoot()
  rmDirBestEffort(root)
  mkdirSync(join(root, 'baseq2', 'demos'), { recursive: true })
  mkdirSync(join(root, 'ctf', 'demos'), { recursive: true })
  // Story 180 D4: an empty `opentdm` dir on disk (not in the installation's `gameDirs`, so the demo stays
  // mod-missing) - the playback channel writes its cfg into the game dir and fails without it.
  mkdirSync(join(root, REPLAYS_PLAY_MISSING_MOD), { recursive: true })
  writeFileSync(join(root, 'baseq2', 'pak0.pak'), 'not a real pak, just needs to exist')
  const executablePath = join(root, process.platform === 'win32' ? 'q2pro.exe' : 'q2pro')
  const spawnable = true
  writeStubEngine(root, executablePath, { lifetimeMs: engineLifetimeMs })

  writeFileSync(
    join(root, 'baseq2', 'demos', REPLAYS_PLAY_BASE_DEMO),
    demoBytesWithGameDir('baseq2'),
  )
  writeFileSync(join(root, 'ctf', 'demos', REPLAYS_PLAY_CTF_DEMO), demoBytesWithGameDir('ctf'))
  copyFileSync(
    join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2'),
    join(root, 'baseq2', 'demos', REPLAYS_PLAY_MISSING_MOD_DEMO),
  )

  const r1q2Root = join(gameRoot(), 'fixture-replays-play-r1q2-install')
  rmDirBestEffort(r1q2Root)
  mkdirSync(join(r1q2Root, 'baseq2'), { recursive: true })
  writeFileSync(join(r1q2Root, 'baseq2', 'pak0.pak'), 'not a real pak, just needs to exist')
  const r1q2Exe = join(r1q2Root, process.platform === 'win32' ? 'r1q2.exe' : 'r1q2')
  writeFileSync(r1q2Exe, 'placeholder - never launched by this flow')

  const brokenRoot = join(gameRoot(), 'fixture-replays-play-broken-install')
  if (brokenInstallation) {
    // Engine present, no pak0.pak: `validation.pak0Missing` (error) -> status invalid -> Repair.
    rmDirBestEffort(brokenRoot)
    mkdirSync(join(brokenRoot, 'baseq2'), { recursive: true })
    writeFileSync(
      join(brokenRoot, process.platform === 'win32' ? 'r1q2.exe' : 'r1q2'),
      'placeholder - never launched by this flow',
    )
  }

  const installation = (id, name, engineKind, rootPath, exe, gameDirs, sortOrder) => ({
    id,
    name,
    rootPath,
    engineKind,
    executablePath: exe,
    launchArgs: [],
    activeGameDir: '',
    detectedVersion: undefined,
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs,
    favorite: false,
    sortOrder,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    lastValidatedAt: undefined,
    lastPlayedAt: undefined,
    totalPlaytimeSeconds: 0,
  })
  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    settings: {
      ...DEFAULT_SETTINGS,
      scanOnFirstRun: false,
      activeInstallationId: REPLAYS_PLAY_Q2PRO_ID,
    },
    installations: [
      installation(
        REPLAYS_PLAY_Q2PRO_ID,
        'Fixture Play Q2PRO',
        'q2pro',
        root,
        executablePath,
        ['baseq2', 'ctf'],
        0,
      ),
      installation(
        REPLAYS_PLAY_R1Q2_ID,
        'Fixture Play R1Q2',
        'r1q2',
        r1q2Root,
        r1q2Exe,
        ['baseq2'],
        1,
      ),
      ...(brokenInstallation
        ? [
            {
              ...installation(
                REPLAYS_PLAY_BROKEN_ID,
                REPLAYS_PLAY_BROKEN_NAME,
                'r1q2',
                brokenRoot,
                join(brokenRoot, process.platform === 'win32' ? 'r1q2.exe' : 'r1q2'),
                ['baseq2'],
                2,
              ),
              status: 'invalid',
            },
          ]
        : []),
    ],
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  return { userDataDir, installRoot: root, executablePath, spawnable }
}

// Story 165 D4: `replays-timeline` - the `replays-play` install, but its stub engine stays up (two
// minutes, or until the flow drops the quit file) so the timeline strip can be steered and screenshot.
export const REPLAYS_TIMELINE_VARIANT = 'replays-timeline'

const REPLAYS_TIMELINE_ENGINE_LIFETIME_MS = 120_000

/** Where the flow's stub engine records executed commands and looks for its quit file - handed to
 * it as `Q2L_UI_ENGINE_COMMAND_LOG` / `Q2L_UI_ENGINE_QUIT_FILE` (and, story 172, `Q2L_UI_ENGINE_KEYS_FILE`) by the flow's `setup()`. */
export function replaysTimelineEngineFiles() {
  const dir = join(UI_VERIFY_ROOT, 'fixture', 'replays-timeline-engine')
  return {
    dir,
    commandLog: join(dir, 'commands.log'),
    quitFile: join(dir, 'quit'),
    ignoreQuitFile: join(dir, 'ignore-quit'),
    keysFile: join(dir, 'keys'),
  }
}

// Story 171 D2: where the stub engine records the stage follower's window lines (`Q2L_UI_ENGINE_WINDOW_LOG`).
export function replaysStageFollowEngineFiles() {
  const files = replaysTimelineEngineFiles()
  return { ...files, windowLog: join(files.dir, 'window.log') }
}

export function writeReplaysTimelineFixture() {
  const files = replaysTimelineEngineFiles()
  rmDirBestEffort(files.dir)
  mkdirSync(files.dir, { recursive: true })
  writeFileSync(files.commandLog, '')
  return {
    ...writeReplaysPlayFixture(REPLAYS_TIMELINE_VARIANT, {
      engineLifetimeMs: REPLAYS_TIMELINE_ENGINE_LIFETIME_MS,
    }),
    ...files,
  }
}

// Story 162 D1: the `replays-play` install plus an `.mvd2` and an `.mvd2.gz` in its `baseq2/demos/`
// (names reuse `REPLAYS_FIXTURE_DEMOS`' literals; the gz is the same PFAU fixture, gzipped here).
export const REPLAYS_PLAY_MVD2_DEMO = 'team_q2dm3.mvd2'

export const REPLAYS_PLAY_MVD2_GZ_DEMO = 'tourney.mvd2.gz'

export const REPLAYS_PLAY_MVD2_GAME_DIR = 'opentdm'

export function writeReplaysPlayMvd2Fixture(variant) {
  const result = writeReplaysPlayFixture(variant)
  // The PFAU recording's header names game dir `opentdm`, so the Q2PRO install must have that mod.
  mkdirSync(join(result.installRoot, REPLAYS_PLAY_MVD2_GAME_DIR), { recursive: true })
  writeFileSync(
    join(result.installRoot, REPLAYS_PLAY_MVD2_GAME_DIR, 'pak0.pak'),
    'not a real pak, just needs to exist',
  )
  const statePath = join(result.userDataDir, STATE_FILE)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.installations[0].gameDirs.push(REPLAYS_PLAY_MVD2_GAME_DIR)
  writeJson(statePath, state)
  const demosDir = join(result.installRoot, 'baseq2', 'demos')
  const bytes = readFileSync(
    join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'PFAU_20221127-053327_q2dm1.mvd2'),
  )
  writeFileSync(join(demosDir, REPLAYS_PLAY_MVD2_DEMO), bytes)
  writeFileSync(join(demosDir, REPLAYS_PLAY_MVD2_GZ_DEMO), gzipSync(bytes))
  return result
}

// --- story 160 D3: the copy-in flows' fixture ----------------------------------------------------
//
// The `replays-play` install plus (a) a stand-in client that LINGERS ~3s instead of exiting at once
// - the copy under `demos/_launcher/` only exists while the game runs, so the flow needs a window
// to see it in: off Windows a shell script that sleeps 3s; on Windows a copy of `cmd.exe` named
// `q2pro.exe` whose installation `launchArgs` are `/d /c ping -n 4 127.0.0.1 >nul & rem`, so the
// launcher's own trailing `+set game ... +demo _launcher/<id>` args land inside the `rem` comment
// (still recorded in main.log's `launching` line); (b) an extra demo folder inside the variant's own
// userData dir holding `copy-a.dm2` and, when 7za is vendored, `copy-pack.zip` with one entry; and
// (c) optionally a `_launcher/leftover.dm2` (sweep flow) or a plain FILE named `_launcher` (the
// not-writable flow).
export const REPLAYS_COPY_IN_INPLACE_DEMO = REPLAYS_PLAY_BASE_DEMO

export const REPLAYS_COPY_IN_EXTRA_DEMO = 'copy-a.dm2'

export const REPLAYS_COPY_IN_ZIP = 'copy-pack.zip'

export const REPLAYS_COPY_IN_ZIP_ENTRY = 'copy-entry.dm2'

export const REPLAYS_COPY_IN_KEEP_DEMO = 'keep.dm2'

export function replaysCopyInExtraFolder(variant) {
  return join(variantUserDataDir(variant), 'copy-in-demos')
}

export function replaysCopyInDemosDir() {
  return join(replaysPlayInstallRoot(), 'baseq2', 'demos')
}

/** `mode`: 'plain' | 'leftover' (seed `_launcher/leftover.dm2` + `keep.dm2`) | 'blocked' (`_launcher` is a file). */
export function writeReplaysCopyInFixture(variant, mode = 'plain') {
  const result = writeReplaysPlayFixture(variant)
  const demosDir = replaysCopyInDemosDir()

  if (process.platform === 'win32') {
    copyFileSync(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
      result.executablePath,
    )
  } else {
    writeFileSync(result.executablePath, '#!/bin/sh\nsleep 3\nexit 0\n')
    chmodSync(result.executablePath, 0o755)
  }

  const folder = replaysCopyInExtraFolder(variant)
  rmDirBestEffort(folder)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, REPLAYS_COPY_IN_EXTRA_DEMO), demoBytesWithGameDir('baseq2'))
  if (vendoredExtractorExists()) {
    const staging = join(bootstrapStagingDir(), `replays-copy-in-zip-${variant}`)
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, REPLAYS_COPY_IN_ZIP_ENTRY), demoBytesWithGameDir('baseq2'))
    execFileSync(
      vendoredSevenZaPath(),
      [
        'a',
        '-tzip',
        '-mx1',
        '-bso0',
        '-bse0',
        '-bd',
        join(folder, REPLAYS_COPY_IN_ZIP),
        REPLAYS_COPY_IN_ZIP_ENTRY,
      ],
      { cwd: staging, windowsHide: true },
    )
  }

  const statePath = join(result.userDataDir, STATE_FILE)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  if (process.platform === 'win32') {
    state.installations[0].launchArgs = [
      '/d',
      '/c',
      'ping',
      '-n',
      '4',
      '127.0.0.1',
      '>nul',
      '&',
      'rem',
    ]
  }
  state.replays = {
    extraFolders: [{ id: `fixture-${variant}-folder`, path: folder, addedAt: FIXED_TIMESTAMP }],
  }
  writeJson(statePath, state)

  if (mode === 'leftover') {
    mkdirSync(join(demosDir, '_launcher'), { recursive: true })
    writeFileSync(join(demosDir, '_launcher', 'leftover.dm2'), 'q2l-fixture-leftover\n', 'utf8')
    writeFileSync(join(demosDir, REPLAYS_COPY_IN_KEEP_DEMO), demoBytesWithGameDir('baseq2'))
  } else if (mode === 'blocked') {
    writeFileSync(
      join(demosDir, '_launcher'),
      'a plain file where the directory should be\n',
      'utf8',
    )
  }
  return { ...result, extraFolder: folder }
}

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../harness.mjs'
import { demoBytesWithGameDir } from './replays-play.mjs'
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

// --- `engine-choice` - a folder holding several engines (story 246) -----------------------------
//
// Two registered installations whose records are written WITHOUT `detectedEngines` (the shape of a
// record that predates the field), so the card only shows its choice after startup revalidation.
export const ENGINE_CHOICE_TWO_ID = 'fixture-engine-choice-two'

export const ENGINE_CHOICE_TWO_NAME = 'Fixture Two Engines'

export const ENGINE_CHOICE_MISSING_ID = 'fixture-engine-choice-missing'

export const ENGINE_CHOICE_MISSING_NAME = 'Fixture Missing Engine'

function engineExecutable(root, kind) {
  return join(root, process.platform === 'win32' ? `${kind}.exe` : kind)
}

function writeEngine(root, kind) {
  const path = engineExecutable(root, kind)
  if (process.platform === 'win32') {
    writeFileSync(path, 'placeholder - never launched by this flow')
  } else {
    writeFileSync(path, '#!/bin/sh\nexit 0\n')
    chmodSync(path, 0o755)
  }
  return path
}

function writeRoot(id, kinds) {
  const root = join(gameRoot(), `${id}-install`)
  rmDirBestEffort(root)
  mkdirSync(join(root, 'baseq2'), { recursive: true })
  writeFileSync(join(root, 'baseq2', 'pak0.pak'), 'not a real pak, just needs to exist')
  for (const kind of kinds) writeEngine(root, kind)
  return root
}

export const ENGINE_CHOICE_DEMO = 'engine-choice.dm2'

function writeDemo(root) {
  mkdirSync(join(root, 'baseq2', 'demos'), { recursive: true })
  writeFileSync(join(root, 'baseq2', 'demos', ENGINE_CHOICE_DEMO), demoBytesWithGameDir('baseq2'))
}

export function writeEngineChoiceFixture(variant = 'engine-choice') {
  const userDataDir = variantUserDataDir(variant)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  const twoRoot = writeRoot(ENGINE_CHOICE_TWO_ID, ['r1q2', 'q2pro', 'kmquake2'])
  writeDemo(twoRoot)
  const missingRoot = writeRoot(ENGINE_CHOICE_MISSING_ID, ['q2pro'])

  const installation = (id, name, rootPath, exe, sortOrder) => ({
    id,
    name,
    rootPath,
    engineKind: 'r1q2',
    executablePath: exe,
    launchArgs: [],
    activeGameDir: '',
    detectedVersion: undefined,
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['baseq2'],
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
      activeInstallationId: ENGINE_CHOICE_TWO_ID,
    },
    installations: [
      installation(
        ENGINE_CHOICE_TWO_ID,
        ENGINE_CHOICE_TWO_NAME,
        twoRoot,
        engineExecutable(twoRoot, 'r1q2'),
        0,
      ),
      installation(
        ENGINE_CHOICE_MISSING_ID,
        ENGINE_CHOICE_MISSING_NAME,
        missingRoot,
        engineExecutable(missingRoot, 'r1q2'),
        1,
      ),
    ],
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  return {
    userDataDir,
    installations: 2,
    configProfiles: 0,
    installRoot: twoRoot,
    executablePath: engineExecutable(twoRoot, 'r1q2'),
  }
}

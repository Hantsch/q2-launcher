import { describe, expect, it } from 'vitest'
import { delimiter } from 'node:path'
import {
  resolveUiHarness,
  uiHarnessPickedFolders,
  UI_HARNESS_ENV,
  UI_HARNESS_PICK_FOLDER_ENV,
} from '../../lib/ui-harness'
import { HARNESS_STORE_SOURCES_ENV, resolveDetectedRetailSourcesOverride } from './harness'

/**
 * `Q2L_UI_PICK_FOLDER` fixture paths: platform-appropriate, since `uiHarnessPickedFolders` splits
 * on `path.delimiter` (`;` on Windows, `:` elsewhere) - a hardcoded Windows drive letter like
 * `C:\fixtures\...` contains its own `:`, which a `:`-delimiter split would tear in two.
 */
const FIXTURE_FOLDER_PROGRAM_FILES =
  process.platform === 'win32' ? 'C:\\Program Files\\fixture-probe' : '/opt/fixture-probe'
const FIXTURE_FOLDER_BOOTSTRAP_TARGET =
  process.platform === 'win32' ? 'C:\\fixtures\\bootstrap-target' : '/fixtures/bootstrap-target'

/** A harness-launched environment, regardless of `isDev`. */
const HARNESS_ENV = {
  [UI_HARNESS_ENV]: '1',
  [UI_HARNESS_PICK_FOLDER_ENV]: `${FIXTURE_FOLDER_PROGRAM_FILES}${delimiter}${FIXTURE_FOLDER_BOOTSTRAP_TARGET}`,
} as NodeJS.ProcessEnv

/**
 * Story 088 D2 (relaxed by story 101 F3): mirrors the gate cases of the download-source override (`services/content/source.test.ts`) one for one, for the new
 * `Q2L_UI_HARNESS_STORE_SOURCES` override (`resolveDetectedRetailSourcesOverride`) - the same
 * security-relevant backdoor discipline, since this one substitutes fixture Steam/GOG/Epic sources
 * for a real detection scan. `Q2L_UI_HARNESS === '1'` alone is the gate; `isDev` is not part of it.
 */
describe('the detected-retail-sources override requires only Q2L_UI_HARNESS', () => {
  const FIXTURE_SOURCES = [
    {
      source: 'steam',
      rootPath: 'C:\\fixtures\\steam-quake2',
      inspection: {
        rootPath: 'C:\\fixtures\\steam-quake2',
        pak0: { exists: true, sizeBytes: 1, matchesRetailSize: true },
        pak1: { exists: true, sizeBytes: 1, matchesRetailSize: true },
        pak2: { exists: false, sizeBytes: null, matchesRetailSize: false },
        verified: true,
        hasVideo: false,
        hasPlayers: false,
      },
    },
  ]
  const FIXTURE_ENV = { [HARNESS_STORE_SOURCES_ENV]: JSON.stringify(FIXTURE_SOURCES) }

  it('both flags off: undefined, so the caller runs the real detection scan', () => {
    expect(resolveDetectedRetailSourcesOverride(resolveUiHarness(FIXTURE_ENV))).toBeUndefined()
  })

  it('only Q2L_UI_HARNESS=1 (isDev false): the fixture sources come back - the env var alone is the gate', () => {
    expect(
      resolveDetectedRetailSourcesOverride(
        resolveUiHarness({ ...FIXTURE_ENV, [UI_HARNESS_ENV]: '1' }),
      ),
    ).toEqual(FIXTURE_SOURCES)
  })

  it('only isDev=true (Q2L_UI_HARNESS unset): still the real detection scan', () => {
    expect(resolveDetectedRetailSourcesOverride(resolveUiHarness(FIXTURE_ENV))).toBeUndefined()
  })

  it('only isDev=true and Q2L_UI_HARNESS set to something other than "1": still the real scan', () => {
    expect(
      resolveDetectedRetailSourcesOverride(
        resolveUiHarness({ ...FIXTURE_ENV, [UI_HARNESS_ENV]: 'true' }),
      ),
    ).toBeUndefined()
  })

  it('both flags on: the fixture sources come back verbatim, and no real scan is involved', () => {
    expect(
      resolveDetectedRetailSourcesOverride(
        resolveUiHarness({ ...FIXTURE_ENV, [UI_HARNESS_ENV]: '1' }),
      ),
    ).toEqual(FIXTURE_SOURCES)
  })

  it('both flags on but the variable is unset: still undefined, not an empty list', () => {
    expect(
      resolveDetectedRetailSourcesOverride(resolveUiHarness({ [UI_HARNESS_ENV]: '1' })),
    ).toBeUndefined()
  })

  it('both flags on but the variable holds malformed JSON: falls back to undefined', () => {
    expect(
      resolveDetectedRetailSourcesOverride(
        resolveUiHarness({ [UI_HARNESS_ENV]: '1', [HARNESS_STORE_SOURCES_ENV]: 'not-json' }),
      ),
    ).toBeUndefined()
  })

  it('both flags on but the variable holds a JSON object, not an array: falls back to undefined', () => {
    expect(
      resolveDetectedRetailSourcesOverride(
        resolveUiHarness({
          [UI_HARNESS_ENV]: '1',
          [HARNESS_STORE_SOURCES_ENV]: '{"not":"an array"}',
        }),
      ),
    ).toBeUndefined()
  })
})

describe('the folder-picker stub requires only Q2L_UI_HARNESS - isDev is not part of the gate', () => {
  it('both flags off: undefined, so the caller opens the real dialog', () => {
    expect(
      uiHarnessPickedFolders(resolveUiHarness({ [UI_HARNESS_PICK_FOLDER_ENV]: 'C:\\fixtures' })),
    ).toBeUndefined()
  })

  it('only Q2L_UI_HARNESS=1 (isDev false): the fixture paths come back, no dialog involved', () => {
    expect(uiHarnessPickedFolders(resolveUiHarness(HARNESS_ENV))).toEqual([
      FIXTURE_FOLDER_PROGRAM_FILES,
      FIXTURE_FOLDER_BOOTSTRAP_TARGET,
    ])
  })

  it('only isDev=true (Q2L_UI_HARNESS unset): still the real dialog', () => {
    expect(
      uiHarnessPickedFolders(resolveUiHarness({ [UI_HARNESS_PICK_FOLDER_ENV]: 'C:\\fixtures' })),
    ).toBeUndefined()
  })

  it('only isDev=true and Q2L_UI_HARNESS set to something other than "1": still the real dialog', () => {
    expect(
      uiHarnessPickedFolders(resolveUiHarness({ ...HARNESS_ENV, [UI_HARNESS_ENV]: 'true' })),
    ).toBeUndefined()
  })

  it('both flags on: the fixture paths come back in order, and no dialog is involved', () => {
    expect(uiHarnessPickedFolders(resolveUiHarness(HARNESS_ENV))).toEqual([
      FIXTURE_FOLDER_PROGRAM_FILES,
      FIXTURE_FOLDER_BOOTSTRAP_TARGET,
    ])
  })

  it('both flags on but Q2L_UI_PICK_FOLDER unset: an empty list (a cancel), still without a dialog', () => {
    expect(uiHarnessPickedFolders(resolveUiHarness({ [UI_HARNESS_ENV]: '1' }))).toEqual([])
  })

  it('drops empty segments, so a trailing delimiter is not a phantom pick', () => {
    const fixtureOne = process.platform === 'win32' ? 'C:\\one' : '/one'
    expect(
      uiHarnessPickedFolders(
        resolveUiHarness({
          [UI_HARNESS_ENV]: '1',
          [UI_HARNESS_PICK_FOLDER_ENV]: `${fixtureOne}${delimiter}`,
        }),
      ),
    ).toEqual([fixtureOne])
  })

  it('agrees with UiHarness.enabled: the env var alone decides, isDev is irrelevant', () => {
    expect(resolveUiHarness({}).enabled).toBe(false)
    expect(resolveUiHarness({ [UI_HARNESS_ENV]: '1' }).enabled).toBe(true)
    expect(resolveUiHarness({}).enabled).toBe(false)
    expect(resolveUiHarness({ [UI_HARNESS_ENV]: '1' }).enabled).toBe(true)
  })
})

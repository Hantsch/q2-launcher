import { describe, expect, it } from 'vitest'
import {
  isTestFile,
  listSourceFiles,
  readRepoFile,
  stripComments,
} from '../../../../test-support/source-tree'

describe('config profile list ownership', () => {
  it('only the config profiles store reads listConfigProfiles', () => {
    const readers = listSourceFiles('src/renderer/src')
      .filter((file) => !isTestFile(file))
      .filter((file) => stripComments(readRepoFile(file)).includes('listConfigProfiles('))

    expect(readers).toEqual([
      'src/renderer/src/modules/config/client.ts',
      'src/renderer/src/modules/config/config-profiles-store.ts',
    ])
  })
})

const PROFILE_PANELS = [
  'SettingsTab.tsx',
  'ControlsTab.tsx',
  'AliasesTab.tsx',
  'OverviewKeyboardPanel.tsx',
  'LayersPanel.tsx',
  'RawFileTab.tsx',
  'CareTab.tsx',
  'AssignmentsMenu.tsx',
  'ProfileAssignmentsPanel.tsx',
  'components/UnsavedChangesTab.tsx',
  'components/ProfileSaveActions.tsx',
].map((file) => `src/renderer/src/modules/config/${file}`)

describe('config profile draft ownership', () => {
  // A prop type member is never comma-terminated; `onChanged: save,` is an argument object.
  it('no config tab or panel declares profile, draft, patch or onChanged props', () => {
    const offenders = PROFILE_PANELS.flatMap((file) =>
      stripComments(readRepoFile(file))
        .split('\n')
        .filter(
          (line) => /^\s+(profile|draft|patch|onChanged)\??:\s/.test(line) && !line.endsWith(','),
        )
        .map((line) => `${file}: ${line.trim()}`),
    )

    expect(offenders).toEqual([])
    expect(
      stripComments(
        readRepoFile('src/renderer/src/modules/config/components/UnsavedChangesTab.tsx'),
      ),
    ).toMatch(/export function UnsavedChangesTab\(\)/)
  })

  it('ProfileDraftProvider is mounted exactly once', () => {
    const mounts = listSourceFiles('src/renderer/src')
      .filter((file) => !isTestFile(file))
      .flatMap((file) =>
        stripComments(readRepoFile(file)).includes('<ProfileDraftProvider') ? [file] : [],
      )

    expect(mounts).toEqual(['src/renderer/src/modules/config/ConfigView.tsx'])
  })
})

describe('ConfigView layout', () => {
  it('ConfigView is under 350 lines and mounts the extracted header, tab strip and list screen', () => {
    const source = readRepoFile('src/renderer/src/modules/config/ConfigView.tsx')
    const code = stripComments(source)

    expect(source.split('\n').length).toBeLessThan(350)
    for (const component of ['ConfigDetailHeader', 'ConfigTabStrip', 'ConfigListScreen']) {
      expect(code).toContain(`import { ${component}`)
      expect(code).toContain(`<${component}`)
    }
  })
})

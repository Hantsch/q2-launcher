import { describe, expect, it } from 'vitest'
import {
  isTestFile,
  listSourceFiles,
  readRepoFile,
  stripComments,
} from '../../../test-support/source-tree'
import { en } from './bundle'

/**
 * Key families whose leaf is only known at runtime - each entry is the static text in front of the
 * interpolation at its call site, so that text must itself occur in production source. A key under
 * one of these counts as used without a literal reference; everything else must be named literally.
 */
export const DYNAMIC_KEY_PREFIXES: readonly string[] = [
  // t(`installation.source.${installation.source}`) in src/renderer/src/views/LibraryView.tsx
  'installation.source.',
  // `runner.kind.${runner.kind}` in src/main/ipc/installations.ts
  'runner.kind.',
  // `runner.unavailable.${runner.kind}` in src/main/ipc/installations.ts
  'runner.unavailable.',
  // `validation.fix.${fix}` in src/renderer/src/components/installations/ChecksList.tsx
  'validation.fix.',
  // t(`dialog.detect.phase.${progress.phase}`) in src/renderer/src/components/installations/DetectDialog.tsx
  'dialog.detect.phase.',
  // t(`common.dateRange.preset.${preset}`) in src/renderer/src/components/ui/DateRangePicker.tsx
  'common.dateRange.preset.',
  // `launch.userinfo.reject.${reason}` in src/shared/launch/userinfo.ts
  'launch.userinfo.reject.',
  // `home.dashboard.tiles.configProfiles.state.${row.own}` in src/renderer/src/modules/home/dashboard/ConfigProfilesTile.tsx
  'home.dashboard.tiles.configProfiles.state.',
  // t(`settings.unlock.feature.${feature}`) in src/renderer/src/components/unlock/UnlockCodePanel.tsx
  'settings.unlock.feature.',

  // `servers.source.error.${reason}` in src/shared/servers/master-records.ts
  'servers.source.error.',
  // t(`servers.gamemode.${row.gamemode}`) in src/renderer/src/modules/servers/ServerRow.tsx
  'servers.gamemode.',
  // t(`servers.sort.column.${sort.column}`) in src/renderer/src/modules/servers/ServersView.tsx
  'servers.sort.column.',
  // t(`servers.sort.direction.${sort.direction}`) in src/renderer/src/modules/servers/ServersView.tsx
  'servers.sort.direction.',
  // t(`servers.mode.${m}`) in src/renderer/src/modules/servers/ServersModeToggle.tsx
  'servers.mode.',
  // t(`servers.engine.${value.engine}`) in src/renderer/src/modules/servers/ServerRulesPanel.tsx
  'servers.engine.',
  // t(`servers.detail.rules.key.${row.key}`) in src/renderer/src/modules/servers/ServerRulesPanel.tsx
  'servers.detail.rules.key.',
  // t(`servers.detail.rules.dmflags.rule.${...}`) in src/renderer/src/modules/servers/ServerRulesPanel.tsx
  'servers.detail.rules.dmflags.rule.',
  // t(`servers.detail.players.column.${key}`) in src/renderer/src/modules/servers/ServerPlayersPanel.tsx
  'servers.detail.players.column.',
  // t(`servers.list.column.${column}`) in src/renderer/src/modules/servers/ServerListHeader.tsx
  'servers.list.column.',

  // `replays.console.error.${checked.reason}` in src/main/modules/replays/playback-console.ts
  'replays.console.error.',
  // t(`replays.detail.field.${field.id}`) in src/renderer/src/modules/replays/components/DemoDetailPanel.tsx
  'replays.detail.field.',
  // t(`replays.sort.column.${column}`) in src/renderer/src/modules/replays/components/DemoListHeader.tsx
  'replays.sort.column.',
  // t(`replays.sort.direction.${sort.direction}`) in src/renderer/src/modules/replays/components/DemoListHeader.tsx
  'replays.sort.direction.',
  // t(`replays.editor.placeholder.${field}`) in src/renderer/src/modules/replays/components/DemoDetailPanel.tsx
  'replays.editor.placeholder.',
  // t(`replays.timeline.waiting.${waitingChain}`) in src/renderer/src/modules/replays/components/DemoTimeline.tsx
  'replays.timeline.waiting.',
  // t(`replays.format.${format}`) in src/renderer/src/modules/replays/row-format.ts
  'replays.format.',

  // t(`bootstrapWizard.step.${step}`) in src/renderer/src/modules/downloads/bootstrap/BootstrapWizard.tsx
  'bootstrapWizard.step.',
  // t(`bootstrapWizard.gameData.store.${source.source}`) in src/renderer/src/modules/downloads/bootstrap/GameDataStep.tsx
  'bootstrapWizard.gameData.store.',
  // t(`bootstrapWizard.confirm.role.${pkg.role}`) in src/renderer/src/modules/downloads/bootstrap/ConfirmStep.tsx
  'bootstrapWizard.confirm.role.',
  // t(`jobs.status.${job.status}`) in src/renderer/src/modules/downloads/components/JobRow.tsx
  'jobs.status.',
  // t(`repair.offer.${offer.kind}`) in src/renderer/src/modules/downloads/repair/RepairDialog.tsx
  'repair.offer.',
  // t(`downloads.failures.detail.step.${...}`) in src/renderer/src/modules/downloads/components/FailureCauseDetail.tsx
  'downloads.failures.detail.step.',

  // `config.settings.groups.${group}` in src/shared/modules/config.ts
  'config.settings.groups.',
  // `config.actionCatalog.use_${w.id}.description` in src/shared/config/catalog/action-catalog.ts
  'config.actionCatalog.',
  // STRUCTURE_MESSAGE_PREFIX in src/shared/config/validation/validate-structure.ts
  'config.validation.structure.',
  // ACTIONS_MESSAGE_PREFIX in src/shared/config/validation/validate-actions.ts
  'config.validation.actions.',
  // t(`config.aliases.origin.${row.origin}`) in src/renderer/src/modules/config/AliasesTab.tsx
  'config.aliases.origin.',
  // t(`config.care.level.${item.level}`) in src/renderer/src/modules/config/CareItemRow.tsx
  'config.care.level.',
  // TIDY_UP_MESSAGE_PREFIX in src/renderer/src/modules/config/lib/tidy-up-findings.ts, plus
  // t(`config.care.tidyUp.kindLabel.${group.kind}`) in src/renderer/src/modules/config/CareBatchFixDialog.tsx
  'config.care.tidyUp.',
  // `config.care.sync.state.${row.state}` in src/renderer/src/modules/config/lib/care-items.ts
  'config.care.sync.state.',
  // TIDY_TITLE_PREFIX in src/renderer/src/modules/config/lib/care-items.ts
  'config.care.item.tidy.title.',
  // HEALTH_TITLE_PREFIX in src/renderer/src/modules/config/lib/care-items.ts
  'config.care.item.health.title.',
  // FILES_CONSEQUENCE_PREFIX in src/renderer/src/modules/config/lib/care-items.ts
  'config.care.item.files.consequence.',
  // ALL_CLEAR_PREFIX in src/renderer/src/modules/config/lib/care-summary.ts
  'config.care.allClear.',
  // t(`config.controls.entryKind.${option}`) in src/renderer/src/modules/config/components/CreateActionDialog.tsx
  'config.controls.entryKind.',
  // t(`config.save.changes.kind.${change.kind}`) in src/renderer/src/modules/config/components/ProfileChangeList.tsx
  'config.save.changes.kind.',
  // t(`config.save.changes.field.${detail.field}`) in src/renderer/src/modules/config/components/ProfileChangeList.tsx
  'config.save.changes.field.',
]

/**
 * Values that may legitimately sit under more than one key, each with the reason. Repeated labels
 * live once under common.label.*, action verbs under common.action.*; a value here is a homonym
 * whose copies play different roles.
 */
export const DUPLICATE_EXCEPTIONS: Record<string, string> = {
  Close: 'The titlebar button closes the window; the others dismiss a panel.',
  Scan: 'A section heading in the servers settings versus the button that starts a cleanup scan.',
  'Download & install':
    'A library button versus the setup wizard title, which are different roles.',
  Reset: 'A column header in the controls grid versus a name-template action button.',
  'Import from files': 'A radio choice in the create dialog versus the import dialog title.',
  'Engine update': 'The update button label versus the engine update dialog title.',
  'Checking for installations you already own…':
    'A wizard step and the retail-upgrade panel each show their own loading state, which are different screens.',
  '{{count}} installed file has changed since it was installed:':
    'The update and remove dialogs each own their wording so the two consequences can diverge.',
  '{{count}} installed files have changed since they were installed:':
    'The update and remove dialogs each own their wording so the two consequences can diverge.',
  '{{count}} row':
    'The group header count and the footer total are counted separately and may be reworded independently.',
  '{{count}} rows':
    'The group header count and the footer total are counted separately and may be reworded independently.',
  '"{{name}}" already exists.':
    'One refusal is for the demo file and the other for its sidecar, which are different conflicts.',
  'Save as quick filter':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Add to address book':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Rename section':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Create section':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Rename sub-section':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Create sub-section':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Create category':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Rename sub-category':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Create sub-category':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Create action':
    'The same words as a dialog title and as its submit button, which are different roles.',
  'Create alias':
    'The same words as a dialog title and as its submit button, which are different roles.',
}

// i18next resolves `t('x', { count })` to `x_one`/`x_other`/..., so the source names only `x`.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

// `*.test-helpers.ts` and the shared test-support tree are test code that `isTestFile` does not
// cover; a key named only there is still dead to the user.
const TEST_ONLY = /(\.test[.-]|^src\/test-support\/)/

function leafKeys(node: unknown, path = ''): string[] {
  if (typeof node === 'string') return [path]
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    leafKeys(child, path ? `${path}.${key}` : key),
  )
}

const keys = leafKeys(en)
const leaves: [string, string][] = keys.map((key) => [
  key,
  key.split('.').reduce((node: any, part) => node[part], en) as string,
])

// A group is a duplicate when at least two of its keys, ignoring plural variants and id-keyed
// families that stay whole, are distinct entries.
function isDuplicate(group: string[]): boolean {
  const own = group.filter((key) => !DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
  return own.length >= 2 && new Set(own.map((key) => key.replace(PLURAL_SUFFIX, ''))).size > 1
}

// Comments are stripped so a key mentioned only in prose does not keep a dead string alive.
const productionSource = listSourceFiles('src')
  .filter((file) => !isTestFile(file) && !TEST_ONLY.test(file))
  .map((file) => stripComments(readRepoFile(file)))
  .join('\n')

// Whole dotted tokens, so `common.add` is not "referenced" by `common.addFolder`.
const referenced = new Set(productionSource.match(/[\w-]+(?:\.[\w-]+)+/g) ?? [])

function isValidPrefix(prefix: string): boolean {
  return (
    prefix.endsWith('.') &&
    prefix.split('.').filter(Boolean).length >= 2 &&
    productionSource.includes(prefix) &&
    keys.some((key) => key.startsWith(prefix))
  )
}

describe('en.json keys', () => {
  it('every leaf key is referenced literally or under an allowlisted dynamic prefix', () => {
    const offenders = keys.filter(
      (key) =>
        !referenced.has(key) &&
        !referenced.has(key.replace(PLURAL_SUFFIX, '')) &&
        !DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    )

    expect(offenders).toEqual([])
  })

  it('every dynamic prefix occurs in production source and covers at least one key', () => {
    expect(DYNAMIC_KEY_PREFIXES.filter((prefix) => !isValidPrefix(prefix))).toEqual([])
    // A bare namespace would exempt a whole module; it occurs in source and covers keys, so only
    // the segment rule stops it.
    expect(isValidPrefix('config.')).toBe(false)
    expect(isValidPrefix('config.care')).toBe(false)
  })
  it('no value appears under more than one key outside the exception list', () => {
    const byValue = new Map<string, string[]>()
    for (const [key, value] of leaves) byValue.set(value, [...(byValue.get(value) ?? []), key])

    const offenders = [...byValue]
      .filter(([value, group]) => isDuplicate(group) && !(value in DUPLICATE_EXCEPTIONS))
      .map(([value, group]) => JSON.stringify(value) + ': ' + group.join(', '))

    expect(offenders).toEqual([])
  })

  it('every duplicate exception still matches a duplicated value', () => {
    const stale = Object.keys(DUPLICATE_EXCEPTIONS).filter((value) => {
      const group = leaves.filter(([, v]) => v === value).map(([key]) => key)
      return !isDuplicate(group)
    })

    expect(stale).toEqual([])
  })
})

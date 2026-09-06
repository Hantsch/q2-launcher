/**
 * The Care tab's item model — story 058 D1.
 *
 * Care is a to-do list (story 058's requirement), so everything it can say is
 * one shape: a `CareItem` with a title, one sentence of consequence and the
 * actions that resolve it. `buildCareItems` folds the three live sources the
 * tab already has — the per-engine validation report (`validation-scope.ts`),
 * the profile's sync rows (`care-sync.ts`) and the tidy-up list
 * (`tidy-up-findings.ts`) — into that one list, grouped and sorted errors
 * first.
 *
 * Pure, like every other `lib/` module here: no DOM, no hooks, no IPC. It
 * never fetches a source, it is handed what the tab already holds. Names it
 * cannot know are left to the renderer: an installation's display name needs
 * the installation list, so a Files item carries `params.target`
 * (`'canonical'` or an installation id) and `params.path`, and the row
 * resolves the name.
 *
 * ## Three things this module deliberately does NOT do
 *
 * 1. **It never invents a "nothing to validate against" item.** When
 *    `validation.status !== 'ok'` there is no report to fold in and `byEngine`
 *    is empty, so no health item is produced — and `care-summary.ts` reads the
 *    same status as `notChecked`, never `clean`. That third state (story 025
 *    review finding F2, story 058 decision 3) belongs to neither side of the
 *    item/all-clear split and is rendered by the tab from `validation.status`
 *    itself.
 * 2. **It never treats an unanswered source as clean.** A sync fetch that is
 *    still loading or has errored simply has no rows to hand in, which yields
 *    no Files items — which is exactly why `allClear` is not "zero items" but
 *    "zero items AND every source answered" (`care-summary.ts`).
 * 3. **It never counts a finding twice.** The alias-wiring rules feed both the
 *    validation report and the tidy-up list (see `care-summary.ts`'s file doc
 *    comment), so a finding both of them report would otherwise appear once in
 *    Config health and once in Tidy-up. The tidy-up row wins, because it is the
 *    one that carries ops and can therefore actually be acted on; the health
 *    row is dropped. `dedupKey` is shared with the tab badge's own dedup, so
 *    the badge and the list can never disagree about what "one finding" is.
 */

import type { TidyUpOp } from '@shared/config/tidy-up'
import { engineLabel } from '@shared/types/engine'
import { canonicalOutOfSyncReason, type CareSyncRow } from './care-sync'
import { dedupKey } from './care-summary'
import type { TidyUpFinding, TidyUpFindingKind } from './tidy-up-findings'
import type { ProfileValidation } from './validation-scope'

/** The three areas AC 3 groups rows by, in the order they are rendered. */
export type CareItemGroup = 'health' | 'files' | 'tidy'

/** A row's severity. `info` never reaches an item: the badge and `totalCounts`
 * have never counted infos either, and a to-do list only lists work. */
export type CareItemLevel = 'error' | 'warning'

/**
 * What a row's button does. The vocabulary AC 3 names.
 *
 * `ops` is set only for the three tidy-up actions - those post
 * `TidyUpOp[]` back through the existing apply path. Every other kind is a
 * call the row makes itself (a write retry, an adopt, a compare, an open, a
 * reveal, a tab switch), so the model names it and stays out of it.
 */
export type CareActionKind =
  | 'apply'
  | 'drop'
  | 'reclassify'
  | 'showInAliases'
  | 'showInControls'
  | 'retry'
  | 'reload'
  | 'compare'
  | 'open'
  | 'reveal'

export interface CareItemAction {
  /** Unique within the whole list — the row keys its pending state by it. */
  key: string
  kind: CareActionKind
  /** i18n key for the button label. Never literal prose. */
  labelKey: string
  /** The exact ops to apply, for `'apply' | 'drop' | 'reclassify'` only. */
  ops?: TidyUpOp[]
}

/** One row of the Care tab: what, why, and what can be done about it. */
export interface CareItem {
  /** Stable and deterministic for an unchanged profile — a React key. */
  id: string
  group: CareItemGroup
  level: CareItemLevel
  /** i18n key naming the thing that is wrong. */
  titleKey: string
  /** i18n key for the one sentence saying what it costs the user. */
  consequenceKey: string
  /** Interpolated into both keys above. Files items additionally carry
   * `target` (`'canonical'` or an installation id) and `path`, which the row
   * needs to resolve a display name and to open/reveal the file. */
  params: Record<string, string | number>
  actions: CareItemAction[]
  /** The `ConfigAction.id` this item names, when it names one - the "Show in
   * Controls" deep link (story 058 D5) is wired off this. Carried straight
   * through from the tidy-up finding it was built from (`tidyItems` below);
   * neither Config health nor Files ever set it. */
  actionId?: string
  /** `Finding.fixKey` (`@shared/config/validation.ts`), carried straight through for a health item -
   * a row with no action button (nothing here is fixable from a list, see the doc comment below)
   * still owes the user the fix hint when the validator emitted one; `ValidationPanel`'s (deleted)
   * `FindingRow` rendered this as a second line. Only Config health ever sets it. */
  fixKey?: string
  /** `Finding.source` (`@shared/config/validation.ts`), same precedent - a literal engine citation,
   * never translated. Only Config health ever sets it. */
  source?: string
}

export interface CareItemsInput {
  validation: ProfileValidation
  /** Every row `toCareSyncRows` produced; `inSync` rows are dropped here (AC 5
   * counts them in the All clear block instead). Empty while the sync fetch is
   * unresolved - which is not the same as clean, see the file doc comment. */
  syncRows: CareSyncRow[]
  tidyUp: TidyUpFinding[]
  /** `profile.dirty`, only used to tell the canonical row's two `outOfSync`
   * causes apart via the existing `canonicalOutOfSyncReason` - unsaved edits of
   * our own must never be offered a Reload, which would throw them away. */
  profileDirty?: boolean
}

/** Story 044 D6's `ALIAS_LINK_KINDS`, moved here with the row model: the three
 * kinds whose params name an alias the Aliases tab can focus. `shadowedBind`/
 * `emptyLayer`/`preservedLine` name a key, a layer or a file:line instead. */
const ALIAS_LINK_KINDS: ReadonlySet<TidyUpFindingKind> = new Set([
  'unreferencedAlias',
  'undefinedAlias',
  'duplicateAlias',
])

const TIDY_TITLE_PREFIX = 'config.care.item.tidy.title.'
const HEALTH_TITLE_PREFIX = 'config.care.item.health.title.'
const FILES_CONSEQUENCE_PREFIX = 'config.care.item.files.consequence.'

/**
 * The validation report's half: one item per finding, with the engine it was
 * raised against named on the row (story 058 decision 2 - the per-engine panel
 * is gone, but "equally weighted, per engine" stays true because every row says
 * which engine it came from).
 *
 * Runs only when `validation.status === 'ok'`; `byEngine` is empty otherwise
 * anyway, but the guard is written out because the difference between "checked,
 * nothing found" and "nothing to check against" is the whole point of AC 8.
 */
function healthItems(validation: ProfileValidation, covered: ReadonlySet<string>): CareItem[] {
  if (validation.status !== 'ok') return []

  const items: CareItem[] = []
  for (const entry of validation.byEngine) {
    for (const finding of entry.findings) {
      if (finding.level === 'info') continue
      if (covered.has(dedupKey(finding.id))) continue
      items.push({
        id: `health:${finding.id}`,
        group: 'health',
        level: finding.level,
        titleKey: `${HEALTH_TITLE_PREFIX}${finding.subject.kind}`,
        consequenceKey: finding.messageKey,
        // `subject`/`engine` last: no validator emits a `subject` param, and the
        // only one that emits `engine` emits this exact engine's own name.
        params: {
          ...(finding.params ?? {}),
          subject: finding.subject.id,
          engine: engineLabel(finding.engine),
        },
        // Nothing here is fixable from a list - a cvar out of range or an
        // over-long file is edited in Settings or Controls, not applied.
        actions: [],
        ...(finding.fixKey ? { fixKey: finding.fixKey } : {}),
        ...(finding.source !== undefined ? { source: finding.source } : {}),
      })
    }
  }
  return items
}

/** `failed` is the only state that describes a write that actually went wrong;
 * the other three describe a copy that is stale, absent or deferred, all of
 * which are warnings. Mirrors `CareSyncSection`'s own tones, where `failed` was
 * the only `danger` row. */
function fileLevel(row: CareSyncRow): CareItemLevel {
  return row.state === 'failed' ? 'error' : 'warning'
}

/**
 * The Files half: one item per row that is not `inSync` (AC 5). Every action
 * offered here is one `CareSyncSection` already offered - a retry on a failed
 * write, and Reload/Compare on the canonical row when the file was changed
 * outside the launcher - plus Open/Reveal on the installation rows, which is
 * what story 057 consolidated here from the Raw file tab.
 *
 * The canonical row's `unsavedChanges` case deliberately gets no action: the
 * copy is stale because the user has edits in flight, and both Reload and a
 * retry would destroy or pre-empt them. Its consequence sentence says to save.
 */
function fileItems(rows: CareSyncRow[], profileDirty: boolean | undefined): CareItem[] {
  const items: CareItem[] = []
  for (const row of rows) {
    if (row.state === 'inSync') continue

    const reason = canonicalOutOfSyncReason(row, profileDirty)
    const isCanonical = row.target === 'canonical'
    const id = `files:${row.target}`
    const actions: CareItemAction[] = []

    if (row.state === 'failed') {
      actions.push({ key: `${id}:retry`, kind: 'retry', labelKey: 'config.care.sync.retry' })
    }
    if (reason === 'externalEdit') {
      actions.push(
        { key: `${id}:reload`, kind: 'reload', labelKey: 'config.care.sync.canonical.reload' },
        { key: `${id}:compare`, kind: 'compare', labelKey: 'config.care.sync.canonical.compare' },
      )
    }
    if (!isCanonical) {
      // A missing file cannot be opened, only located - so `missing` rows keep
      // Reveal (which opens the containing folder) and drop Open.
      if (row.state !== 'missing') {
        actions.push({ key: `${id}:open`, kind: 'open', labelKey: 'config.raw.openEditor' })
      }
      actions.push({ key: `${id}:reveal`, kind: 'reveal', labelKey: 'config.raw.reveal' })
    }

    items.push({
      id,
      group: 'files',
      level: fileLevel(row),
      titleKey: reason
        ? `config.care.sync.canonical.${reason}`
        : `config.care.sync.state.${row.state}`,
      consequenceKey: reason
        ? `config.care.sync.canonical.${reason}Hint`
        : `${FILES_CONSEQUENCE_PREFIX}${row.state}`,
      params: {
        target: row.target,
        path: row.path,
        ...(row.messageKey ? { messageKey: row.messageKey } : {}),
      },
      actions,
    })
  }
  return items
}

/**
 * The tidy-up half: one item per finding, with exactly the actions
 * `CareTidyUpSection.actionsFor` offered - all of a finding's ops behind one
 * Apply for every kind but `preservedLine`, which splits its two ops into Drop
 * and Re-classify so the user chooses rather than being shown the line twice
 * (AC 4). A `'report'` finding has no ops and therefore no action, which is the
 * honest rendering of "there is no fix this module may pick".
 */
function tidyItems(findings: TidyUpFinding[]): CareItem[] {
  return findings.map((finding) => {
    const id = `tidy:${finding.id}`
    const actions: CareItemAction[] = []

    if (finding.kind === 'preservedLine') {
      const drop = finding.ops[0]
      if (drop) {
        actions.push({
          key: `${id}:drop`,
          kind: 'drop',
          labelKey: 'config.care.tidyUp.action.drop',
          ops: [drop],
        })
      }
      const reclassify = finding.ops[1]
      if (reclassify) {
        actions.push({
          key: `${id}:reclassify`,
          kind: 'reclassify',
          labelKey: 'config.care.tidyUp.action.reclassify',
          ops: [reclassify],
        })
      }
    } else if (finding.ops.length > 0) {
      actions.push({
        key: `${id}:apply`,
        kind: 'apply',
        labelKey: 'config.care.tidyUp.action.apply',
        ops: finding.ops,
      })
    }

    if (ALIAS_LINK_KINDS.has(finding.kind)) {
      actions.push({
        key: `${id}:showInAliases`,
        kind: 'showInAliases',
        labelKey: 'config.care.tidyUp.action.showInAliases',
      })
    }

    // Gated independently of the alias link above (story 058 D5) - a finding
    // could in principle name neither, and `shadowedBind` today names only
    // this one, never an alias.
    if (finding.actionId) {
      actions.push({
        key: `${id}:showInControls`,
        kind: 'showInControls',
        labelKey: 'config.care.tidyUp.action.showInControls',
      })
    }

    return {
      id,
      group: 'tidy' as const,
      level: finding.level,
      titleKey: `${TIDY_TITLE_PREFIX}${finding.kind}`,
      consequenceKey: finding.messageKey,
      params: finding.params,
      actions,
      ...(finding.actionId ? { actionId: finding.actionId } : {}),
    }
  })
}

/** Errors before warnings, everything else left in source order - `sort` is
 * stable, so two rows of the same level keep the order their source produced
 * them in (validation: assignment order per engine; sync: canonical then
 * assignment order; tidy-up: `analyzeTidyUp`'s fixed source order). */
function errorsFirst(items: CareItem[]): CareItem[] {
  return [...items].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}

/**
 * Every piece of work `profile` currently has, as one list: Config health, then
 * Files, then Tidy-up, errors first within each group.
 *
 * An empty result does NOT by itself mean "all clear" - see `careSummary`,
 * which additionally requires every source to have actually answered.
 */
export function buildCareItems(input: CareItemsInput): CareItem[] {
  const tidy = tidyItems(input.tidyUp)
  // Built first: a finding both lists report is kept here and dropped from the
  // health group, because this is the copy that carries the ops.
  const covered = new Set(input.tidyUp.map((finding) => dedupKey(finding.sourceFindingId)))

  return [
    ...errorsFirst(healthItems(input.validation, covered)),
    ...errorsFirst(fileItems(input.syncRows, input.profileDirty)),
    ...errorsFirst(tidy),
  ]
}

/** The items of one group, in the order `buildCareItems` already put them in -
 * so the tab can render a group without re-sorting or re-filtering. */
export function itemsInGroup(items: CareItem[], group: CareItemGroup): CareItem[] {
  return items.filter((item) => item.group === group)
}

import { useTranslation } from 'react-i18next'
import { Check, TriangleAlert } from 'lucide-react'
import type {
  BootstrapDataSource,
  DetectedRetailSource,
  GameDataSourceVerdict,
} from '@shared/modules/downloads'
import { formatBytes } from '../../../lib/format'
import { PathPicker } from '../../../components/ui/controls'

/**
 * Story 088 fix cycle (review F3): the AC3 mitigation for the unresolved 2023 re-release pak-size
 * question ("the AC3 message names the file and its actual size, so the first affected user report
 * yields the number a later story needs") only holds if the actual byte count reaches the string -
 * `RetailSourceInspection.pak0`/`pak1` already carry it, but only these two `unverifiedReason` keys
 * are a size mismatch (as opposed to "missing entirely"), so only these two get the actual size
 * interpolated in.
 */
const SIZE_MISMATCH_REASON_TO_PAK = {
  'bootstrap.retailSource.pak0SizeMismatch': 'pak0',
  'bootstrap.retailSource.pak1SizeMismatch': 'pak1',
} as const

/**
 * Story 088 D5, the wizard's new step between `EngineStep` and `TargetStep`: choose whether the
 * game data comes from [[074]]'s free download or a copy of a detected Steam/GOG/Epic
 * installation (AC1/AC2). Mirrors `EngineStep`'s button-choice shape for the two data-source
 * choices, and adds a second-level picker for the detected sources themselves.
 *
 * Story 089 D4 adds a third choice, `'existing-folder'` (AC1): a hand-picked folder, always
 * offered regardless of whether any store source was detected. Picking it reveals a browse button
 * and, once a folder is chosen, the `GameDataSourceVerdict` for it (AC2) - `kind: 'retail'` names
 * the paks found, `kind: 'demo'` still lets the user proceed (AC4), and `kind: 'unusable'` shows
 * `reason` and blocks Next (AC5); `BootstrapWizard`'s `canProceed.gameData` is what actually
 * enforces that gate, this component only renders the verdict it is handed.
 *
 * AC1's "absent, not disabled" rule: the `store-copy` choice row is only rendered at all when
 * `sources` is non-empty - there is no disabled placeholder for the empty case. The existing-folder
 * row has no such condition; it is always rendered.
 *
 * AC3's "listed but not selectable": every detected entry renders, including an unverified one,
 * but only a `verified` entry's row is clickable; an unverified one shows
 * `inspection.unverifiedReason` underneath instead.
 *
 * `data-testid`s (D6's e2e depends on these): `bootstrap-gamedata-choice-free-download`,
 * `bootstrap-gamedata-choice-store-copy` (present only when `sources.length > 0`),
 * `bootstrap-gamedata-choice-existing-folder`, `bootstrap-gamedata-source-<index>` (one row per
 * detected entry, store + path in its text content), `bootstrap-gamedata-source-<index>-unverified`
 * (the AC3 reason line, present only for an unverified entry), `bootstrap-gamedata-folder-browse`,
 * `bootstrap-gamedata-folder-path`, `bootstrap-gamedata-folder-checking`,
 * `bootstrap-gamedata-folder-verdict-retail`/`-demo`/`-unusable` (exactly one, once a verdict has
 * resolved).
 */
export function GameDataStep({
  sources,
  dataSource,
  onDataSourceChange,
  copySourcePath,
  onCopySourcePathChange,
  folderPath,
  onBrowseFolder,
  folderVerdict,
  checkingFolder,
}: {
  sources: DetectedRetailSource[] | null
  dataSource: BootstrapDataSource
  onDataSourceChange: (next: BootstrapDataSource) => void
  copySourcePath: string | null
  onCopySourcePathChange: (next: string | null) => void
  /** Story 089 D4: the hand-picked folder path for the `'existing-folder'` choice, or `null`
   * before the user has browsed for one. */
  folderPath: string | null
  onBrowseFolder: () => void
  /** The last-resolved verdict for `folderPath`, or `null` while none has resolved yet. */
  folderVerdict: GameDataSourceVerdict | null
  checkingFolder: boolean
}) {
  const { t } = useTranslation()

  if (sources === null) {
    return <p className="text-xs text-ink-muted">{t('bootstrapWizard.gameData.loading')}</p>
  }

  const hasDetected = sources.length > 0

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-ink-muted">{t('bootstrapWizard.gameData.body')}</p>

      <div className="space-y-2">
        <ChoiceRow
          testId="bootstrap-gamedata-choice-free-download"
          selected={dataSource === 'free-download'}
          title={t('bootstrapWizard.gameData.freeDownload.title')}
          body={t('bootstrapWizard.gameData.freeDownload.body')}
          onClick={() => onDataSourceChange('free-download')}
        />
        {hasDetected && (
          <ChoiceRow
            testId="bootstrap-gamedata-choice-store-copy"
            selected={dataSource === 'store-copy'}
            title={t('bootstrapWizard.gameData.storeCopy.title')}
            body={t('bootstrapWizard.gameData.storeCopy.body')}
            onClick={() => onDataSourceChange('store-copy')}
          />
        )}
        {/* Story 089 D4 (AC1): always offered, unlike `store-copy` above - it never depends on
            whether anything was detected. */}
        <ChoiceRow
          testId="bootstrap-gamedata-choice-existing-folder"
          selected={dataSource === 'existing-folder'}
          title={t('bootstrapWizard.gameData.existingFolder.title')}
          body={t('bootstrapWizard.gameData.existingFolder.body')}
          onClick={() => onDataSourceChange('existing-folder')}
        />
      </div>

      {dataSource === 'store-copy' && hasDetected && (
        <div className="space-y-2" data-testid="bootstrap-gamedata-source-list">
          {sources.map((source, index) => {
            const verified = source.inspection.verified
            const isSelected = copySourcePath === source.rootPath
            return (
              <div key={source.rootPath} className="space-y-1">
                <button
                  type="button"
                  disabled={!verified}
                  aria-pressed={isSelected}
                  onClick={() => onCopySourcePathChange(source.rootPath)}
                  data-testid={`bootstrap-gamedata-source-${index}`}
                  className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-colors ${
                    !verified
                      ? 'cursor-not-allowed border-line-strong bg-void/10 opacity-60'
                      : isSelected
                        ? 'border-flame-600 bg-void/40'
                        : 'border-line-strong bg-void/10 hover:bg-void/25'
                  }`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full ${
                      isSelected ? 'bg-flame-500 text-flame-ink' : 'bg-transparent'
                    }`}
                  >
                    {isSelected && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-sm tracking-[0.04em] text-ink uppercase">
                      {t(`bootstrapWizard.gameData.store.${source.source}`)}
                    </p>
                    <p className="truncate text-xs text-ink-muted" title={source.rootPath}>
                      {source.rootPath}
                    </p>
                  </div>
                </button>
                {!verified && source.inspection.unverifiedReason && (
                  <p
                    className="pl-3 text-xs text-danger"
                    data-testid={`bootstrap-gamedata-source-${index}-unverified`}
                  >
                    {t(
                      source.inspection.unverifiedReason,
                      sizeMismatchParams(source.inspection, source.inspection.unverifiedReason),
                    )}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {dataSource === 'existing-folder' && (
        <div className="space-y-2" data-testid="bootstrap-gamedata-folder">
          <div data-testid="bootstrap-gamedata-folder-path">
            <PathPicker
              value={folderPath ?? ''}
              placeholder={t('bootstrapWizard.gameData.existingFolder.placeholder')}
              onBrowse={onBrowseFolder}
              browseLabel={t('common.browse')}
            />
          </div>

          {checkingFolder && (
            <p className="text-xs text-ink-muted" data-testid="bootstrap-gamedata-folder-checking">
              {t('bootstrapWizard.gameData.existingFolder.checking')}
            </p>
          )}

          {!checkingFolder && folderVerdict && (
            <FolderVerdict verdict={folderVerdict} />
          )}
        </div>
      )}
    </div>
  )
}

/** Story 089 D4 (AC2/AC4/AC5): renders the resolved `GameDataSourceVerdict` for the hand-picked
 * folder - a positive line naming the paks found for `retail`, a demo-is-fine notice for `demo`
 * (AC4: not a rejection), and the translated `reason` for `unusable` (AC5), which is also what
 * `BootstrapWizard`'s `canProceed.gameData` keys off to keep Next disabled. */
function FolderVerdict({ verdict }: { verdict: GameDataSourceVerdict }) {
  const { t } = useTranslation()

  if (verdict.kind === 'unusable') {
    return (
      <p
        className="flex items-start gap-2 text-xs leading-relaxed text-danger"
        data-testid="bootstrap-gamedata-folder-verdict-unusable"
      >
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>{t(verdict.reason ?? 'bootstrapWizard.gameData.existingFolder.unusableFallback')}</span>
      </p>
    )
  }

  const pakNames = verdict.paks
    .filter((pak) => pak.retail)
    .map((pak) => pak.name)
    .join(', ')

  if (verdict.kind === 'retail') {
    return (
      <p className="flex items-start gap-2 text-xs leading-relaxed text-ink" data-testid="bootstrap-gamedata-folder-verdict-retail">
        <Check className="mt-0.5 size-3.5 shrink-0 text-success" strokeWidth={3} />
        <span>{t('bootstrapWizard.gameData.existingFolder.retailVerdict', { paks: pakNames })}</span>
      </p>
    )
  }

  return (
    <p
      className="flex items-start gap-2 text-xs leading-relaxed text-ink-dim"
      data-testid="bootstrap-gamedata-folder-verdict-demo"
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>{t('bootstrapWizard.gameData.existingFolder.demoVerdict')}</span>
    </p>
  )
}

/** See `SIZE_MISMATCH_REASON_TO_PAK` above - `{}` for every other reason key, so `t()` renders the
 * static string unchanged. */
function sizeMismatchParams(
  inspection: DetectedRetailSource['inspection'],
  reasonKey: string,
): Record<string, string> {
  const pak = (SIZE_MISMATCH_REASON_TO_PAK as Record<string, 'pak0' | 'pak1' | undefined>)[reasonKey]
  if (!pak) return {}
  return { actualSize: formatBytes(inspection[pak].sizeBytes ?? undefined) }
}

function ChoiceRow({
  testId,
  selected,
  title,
  body,
  onClick,
}: {
  testId: string
  selected: boolean
  title: string
  body: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-colors ${
        selected ? 'border-flame-600 bg-void/40' : 'border-line-strong bg-void/10 hover:bg-void/25'
      }`}
    >
      <span
        className={`grid size-6 shrink-0 place-items-center rounded-full ${
          selected ? 'bg-flame-500 text-flame-ink' : 'bg-transparent'
        }`}
      >
        {selected && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <div className="min-w-0">
        <p className="font-display text-sm tracking-[0.04em] text-ink uppercase">{title}</p>
        <p className="text-xs text-ink-muted">{body}</p>
      </div>
    </button>
  )
}

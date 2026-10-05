import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import type { BootstrapTargetProposal, BootstrapTargetVerdict } from '@shared/modules/downloads'
import { Checkbox, Field, Input, PathPicker } from '../../../components/ui/controls'

/**
 * Story 074, step 2: the target folder and the verdict for it.
 *
 * Every warning the verdict carries needs its own acknowledge before Next enables - the wizard
 * never re-derives "safe to proceed" from the raw fields, `BootstrapWizard` owns that gate and
 * this component only reports which acknowledges are checked.
 *
 * The picker chooses the location; the final path is the main process's proposal for it (the
 * location itself when empty or missing, else a named subfolder) and is always shown as text.
 *
 * `data-testid`s (the e2e flow depends on these): `bootstrap-name-input`, `bootstrap-target-path-input`,
 * `bootstrap-target-folder-name`, `bootstrap-target-final-path`, `bootstrap-target-install-here`,
 * `bootstrap-target-blocked`, `bootstrap-target-programfiles-warning`,
 * `bootstrap-target-programfiles-acknowledge`, `bootstrap-target-nonempty-warning`,
 * `bootstrap-target-nonempty-acknowledge`, `bootstrap-target-notwritable-warning`,
 * `bootstrap-target-notwritable-acknowledge`.
 */
export function TargetStep({
  name,
  onNameChange,
  parentPath,
  proposal,
  folderName,
  onFolderNameChange,
  onBrowse,
  verdict,
  checking,
  ackProgramFiles,
  onAckProgramFilesChange,
  onPickWriteDir,
  ackNonEmpty,
  onAckNonEmptyChange,
  ackNotWritable,
  onAckNotWritableChange,
}: {
  name: string
  onNameChange: (next: string) => void
  parentPath: string
  proposal: BootstrapTargetProposal | null
  folderName: string
  onFolderNameChange: (next: string) => void
  onBrowse: () => void
  verdict: BootstrapTargetVerdict | null
  checking: boolean
  ackProgramFiles: boolean
  onAckProgramFilesChange: (next: boolean) => void
  onPickWriteDir: () => void
  ackNonEmpty: boolean
  onAckNonEmptyChange: (next: boolean) => void
  ackNotWritable: boolean
  onAckNotWritableChange: (next: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <Field label={t('common.label.name')} htmlFor="bootstrap-name-input">
        <Input
          id="bootstrap-name-input"
          value={name}
          maxLength={120}
          onChange={(event) => onNameChange(event.target.value)}
          data-testid="bootstrap-name-input"
        />
      </Field>

      <Field label={t('bootstrapWizard.target.locationLabel')}>
        <div data-testid="bootstrap-target-path-input">
          <PathPicker
            value={parentPath}
            placeholder={t('bootstrapWizard.target.placeholder')}
            onBrowse={onBrowse}
            browseLabel={t('common.label.browse')}
          />
        </div>
      </Field>

      {proposal && !proposal.installHere && (
        <Field
          label={t('bootstrapWizard.target.folderNameLabel')}
          htmlFor="bootstrap-target-folder-name"
        >
          <Input
            id="bootstrap-target-folder-name"
            value={folderName}
            maxLength={255}
            onChange={(event) => onFolderNameChange(event.target.value)}
            data-testid="bootstrap-target-folder-name"
          />
        </Field>
      )}

      {proposal && (
        <div className="space-y-1 text-xs">
          <p className="text-ink-muted">{t('bootstrapWizard.target.finalPathLabel')}</p>
          <p
            className="break-all text-ink"
            title={proposal.targetPath}
            data-testid="bootstrap-target-final-path"
          >
            {proposal.targetPath}
          </p>
          {proposal.installHere && (
            <p className="text-ink-muted" data-testid="bootstrap-target-install-here">
              {t('bootstrapWizard.target.installHere')}
            </p>
          )}
        </div>
      )}

      {checking && <p className="text-xs text-ink-muted">{t('common.label.checkingFolder')}</p>}

      {verdict?.blocked && (
        <WarningBox testId="bootstrap-target-blocked" tone="danger">
          {t(
            verdict.blockedReason === 'alreadyInstalled'
              ? 'bootstrapWizard.target.blocked.alreadyInstalled'
              : 'bootstrapWizard.target.blocked.unsafePath',
          )}
        </WarningBox>
      )}

      {verdict && !verdict.blocked && verdict.programFiles && (
        <WarningBox testId="bootstrap-target-programfiles-warning" tone="warning">
          <p>{t('bootstrapWizard.target.programFiles.body')}</p>
          <button
            type="button"
            className="text-left text-xs text-flame-300 underline hover:text-flame-200"
            onClick={onPickWriteDir}
          >
            {t('bootstrapWizard.target.programFiles.remedyButton')}
          </button>
          <p className="text-xs text-ink-muted">
            {t('bootstrapWizard.target.programFiles.remedyNote')}
          </p>
          <div data-testid="bootstrap-target-programfiles-acknowledge">
            <Checkbox
              checked={ackProgramFiles}
              onChange={onAckProgramFilesChange}
              label={t('common.action.understandContinue')}
              className="pt-1"
            />
          </div>
        </WarningBox>
      )}

      {verdict && !verdict.blocked && verdict.notWritable && (
        <WarningBox testId="bootstrap-target-notwritable-warning" tone="warning">
          <p>{t('bootstrapWizard.target.notWritable.body')}</p>
          <div data-testid="bootstrap-target-notwritable-acknowledge">
            <Checkbox
              checked={ackNotWritable}
              onChange={onAckNotWritableChange}
              label={t('common.action.understandContinue')}
              className="pt-1"
            />
          </div>
        </WarningBox>
      )}

      {verdict && !verdict.blocked && verdict.entries.length > 0 && (
        <WarningBox testId="bootstrap-target-nonempty-warning" tone="warning">
          <p>{t('bootstrapWizard.target.nonEmpty.body')}</p>
          <ul className="max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs text-ink-dim">
            {verdict.entries.map((entry) => (
              <li key={entry} className="truncate">
                {entry}
              </li>
            ))}
          </ul>
          <div data-testid="bootstrap-target-nonempty-acknowledge">
            <Checkbox
              checked={ackNonEmpty}
              onChange={onAckNonEmptyChange}
              label={t('bootstrapWizard.target.nonEmpty.acknowledge')}
              className="pt-1"
            />
          </div>
        </WarningBox>
      )}
    </div>
  )
}

function WarningBox({
  tone,
  testId,
  children,
}: {
  tone: 'warning' | 'danger'
  testId: string
  children: ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className={
        tone === 'danger'
          ? 'space-y-2 rounded-sm border border-danger/40 bg-danger/8 p-3 text-xs leading-relaxed text-danger'
          : 'space-y-2 rounded-sm border border-warning/40 bg-warning/8 p-3 text-xs leading-relaxed text-ink-dim'
      }
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
      </div>
    </div>
  )
}

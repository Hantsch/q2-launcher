import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import type { BootstrapTargetVerdict } from '@shared/modules/downloads'
import { Checkbox, Field, PathPicker } from '../../../components/ui/controls'

/**
 * Story 074 D6, step 2: the target folder and the D2 verdict for it.
 *
 * Every warning the verdict carries needs its own acknowledge before Next enables - the wizard
 * never re-derives "safe to proceed" from the raw fields, `BootstrapWizard` owns that gate and
 * this component only reports which acknowledges are checked.
 *
 * `data-testid`s (D8's e2e depends on these): `bootstrap-target-path-input`,
 * `bootstrap-target-blocked`, `bootstrap-target-programfiles-warning`,
 * `bootstrap-target-programfiles-acknowledge`, `bootstrap-target-nonempty-warning`,
 * `bootstrap-target-nonempty-acknowledge`, `bootstrap-target-notwritable-warning`,
 * `bootstrap-target-notwritable-acknowledge`.
 */
export function TargetStep({
  targetPath,
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
  targetPath: string
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
      <Field label={t('bootstrapWizard.target.label')}>
        <div data-testid="bootstrap-target-path-input">
          <PathPicker
            value={targetPath}
            placeholder={t('bootstrapWizard.target.placeholder')}
            onBrowse={onBrowse}
            browseLabel={t('common.browse')}
          />
        </div>
      </Field>

      {checking && <p className="text-xs text-ink-muted">{t('bootstrapWizard.target.checking')}</p>}

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
          <p className="text-xs text-ink-muted">{t('bootstrapWizard.target.programFiles.remedyNote')}</p>
          <div data-testid="bootstrap-target-programfiles-acknowledge">
            <Checkbox
              checked={ackProgramFiles}
              onChange={onAckProgramFilesChange}
              label={t('bootstrapWizard.target.programFiles.acknowledge')}
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
              label={t('bootstrapWizard.target.notWritable.acknowledge')}
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

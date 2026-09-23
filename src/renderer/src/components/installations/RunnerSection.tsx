import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RunnerOption } from '@shared/ipc'
import type { Installation, LaunchPlan, Outcome } from '@shared/types'
import { cn } from '../../lib/cn'
import { invoke } from '../../lib/bridge'
import { useLauncher } from '../../store/useLauncher'
import { SectionLabel } from '../ui/primitives'

/**
 * Story 103 D7: which runner (native, or a Windows-compatibility layer found on a Linux host)
 * launches this installation's executable, and the resolved command that choice produces.
 *
 * First implementation in the app of CLAUDE.md's platform-parity rule: an unavailable runner is
 * never hidden - it stays in the list, `disabled`, with its reason rendered as visible text right
 * under its label (not a `title`-only tooltip, which a screen reader and a glance both miss).
 *
 * Not rendered on `win32` at all (AC8) - the host OS is the only possible runner there, so there is
 * nothing to choose. `installations:listRunners` would technically still answer (a single `native`
 * entry), but a picker with exactly one, permanently-selected, undisablable option is not a choice;
 * showing it would only invite a click that does nothing.
 */
export function RunnerSection({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  const platform = useLauncher((state) => state.appInfo?.platform)
  const updateInstallation = useLauncher((state) => state.updateInstallation)

  const [runnersResult, setRunnersResult] = useState<Outcome<RunnerOption[]> | null>(null)
  const [planResult, setPlanResult] = useState<Outcome<LaunchPlan> | null>(null)

  // `installation.runner` is a dependency (not just `installation.id`) so the preview re-fetches
  // whenever the effective runner choice changes: `updateInstallation` writes it via
  // `installations:update`, the main process pushes a fresh `installations:changed` list, and the
  // store hands this component a new `installation` object with the new `.runner` value (see
  // LibraryView, which renders this component from `state.installations`). Without this, the
  // preview would keep showing the command for whichever runner was selected at mount time.
  useEffect(() => {
    let cancelled = false
    setRunnersResult(null)
    setPlanResult(null)

    void invoke('installations:listRunners', installation.id).then((result) => {
      if (!cancelled) setRunnersResult(result)
    })
    void invoke('launch:plan', { installationId: installation.id }).then((result) => {
      if (!cancelled) setPlanResult(result)
    })

    return () => {
      cancelled = true
    }
  }, [installation.id, installation.runner])

  // Platform unknown (appInfo not loaded yet) or win32 (AC8, exactly one runner, nothing to
  // choose): render nothing rather than guessing.
  if (platform === undefined || platform === 'win32') return null

  const runners = runnersResult?.ok ? runnersResult.value : []

  return (
    <div
      id={`installation-runner-${installation.id}`}
      data-testid="installation-runner"
      tabIndex={-1}
      className="space-y-2 border-t border-line pt-3 outline-none"
    >
      <SectionLabel>{t('runner.heading')}</SectionLabel>

      {runnersResult && !runnersResult.ok && (
        <p className="text-xs text-danger">
          {t(runnersResult.error.key, runnersResult.error.params ?? {})}
        </p>
      )}

      {!runnersResult && <p className="text-xs text-ink-muted">{t('common.loading')}</p>}

      {runners.length > 0 && (
        <div role="radiogroup" aria-label={t('runner.heading')} className="space-y-1.5">
          {runners.map((option) => (
            <RunnerOptionRow
              key={`${option.kind}-${option.id}`}
              option={option}
              selected={installation.runner === option.id}
              onSelect={() =>
                void updateInstallation({ id: installation.id, runner: option.id })
              }
            />
          ))}
        </div>
      )}

      {planResult?.ok && (
        <p className="numeric text-xs text-ink-muted" data-testid="installation-runner-preview" data-selectable>
          <span className="text-ink-faint">{t('runner.preview.label')}: </span>
          {planResult.value.preview}
        </p>
      )}

      {/* AC7's headline case (no runner available for a PE executable) surfaces here: a failed
          `launch:plan` is exactly as visible as a failed `installations:listRunners` above, not
          silently dropped. */}
      {planResult && !planResult.ok && (
        <p
          className="text-xs text-danger"
          data-testid="installation-runner-preview"
          data-selectable
        >
          {t(planResult.error.key, planResult.error.params ?? {})}
        </p>
      )}
    </div>
  )
}

function RunnerOptionRow({
  option,
  selected,
  onSelect,
}: {
  option: RunnerOption
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={!option.available}
        data-testid={`installation-runner-option-${option.kind}`}
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm border px-2.5 py-1.5 text-left text-xs',
          'transition-colors duration-[--dur-fast]',
          'disabled:pointer-events-none disabled:opacity-60',
          selected
            ? 'border-flame-600 bg-flame-900/30 text-flame-200'
            : 'border-line-strong bg-raised text-ink-dim hover:border-line-strong hover:text-ink',
        )}
      >
        {t(option.labelKey)}
      </button>
      {/* Platform-parity rule (CLAUDE.md): the reason is visible text next to the disabled
          control, not only a `title` tooltip - a screen reader and a glance both miss that. */}
      {!option.available && option.reasonKey && (
        <p
          className="pl-2.5 text-[11px] leading-relaxed text-ink-muted"
          data-testid={`installation-runner-reason-${option.kind}`}
        >
          {t(option.reasonKey)}
        </p>
      )}
    </div>
  )
}

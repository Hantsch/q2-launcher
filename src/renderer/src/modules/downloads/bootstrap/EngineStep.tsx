import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { engineLabel } from '@shared/types/engine'
import type { BootstrapEngineOption } from '@shared/modules/downloads'
import { EmptyState, Panel } from '../../../components/ui/primitives'

/**
 * Story 074 D6, step 1: the wizard's engine choice.
 *
 * `BOOTSTRAP_SUPPORTED_ENGINES` is `['q2pro']` this sprint, so there is exactly one real choice -
 * a selector with one option would be theatre. This renders that one option as a pre-selected
 * confirmation instead. An empty `options` array (the manifest pinned nothing this wizard can
 * offer) is a dead end shown as an empty state, not a step the user can push past.
 */
export function EngineStep({ options }: { options: BootstrapEngineOption[] | null }) {
  const { t } = useTranslation()

  if (options === null) {
    return <p className="text-xs text-ink-muted">{t('bootstrapWizard.engine.loading')}</p>
  }

  if (options.length === 0) {
    return (
      <Panel>
        <EmptyState
          title={t('bootstrapWizard.engine.empty.title')}
          body={t('bootstrapWizard.engine.empty.body')}
        />
      </Panel>
    )
  }

  const option = options[0]

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-ink-muted">{t('bootstrapWizard.engine.body')}</p>
      <div
        className="flex items-center gap-3 rounded-sm border border-flame-600 bg-void/40 p-3"
        data-testid="bootstrap-engine-q2pro"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-flame-500 text-flame-ink">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm tracking-[0.04em] text-ink uppercase">
            {engineLabel(option.engine)}
          </p>
          <p className="text-xs text-ink-muted">
            {t('bootstrapWizard.engine.version', { version: option.version })}
          </p>
        </div>
      </div>
    </div>
  )
}

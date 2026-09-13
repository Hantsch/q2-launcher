import { useTranslation } from 'react-i18next'
import { Check, ExternalLink } from 'lucide-react'
import { engineLabel } from '@shared/types/engine'
import type { EngineKind } from '@shared/types'
import type { BootstrapEngineOption } from '@shared/modules/downloads'
import { invoke } from '../../../lib/bridge'
import { EmptyState, Panel } from '../../../components/ui/primitives'

/** Story 080 D3 (AC8): the exact upstream source this launcher's R1Q2 build is pinned to. */
const R1Q2_SOURCE_TREE_URL =
  'https://github.com/vic7or777/R1Q2-MSVC/tree/8af268c795293406f6f7d4328bf0d4f225294d6e'

/**
 * Story 080 finding fix: Microsoft's own stable `aka.ms` redirect for the current x86 VC++
 * Redistributable installer - the "actionable official Microsoft runtime-install instruction" the
 * story's Evidence section calls for, alongside `downloads.error.missingRuntime`'s own copy.
 */
const VC_REDIST_X86_URL = 'https://aka.ms/vs/17/release/vc_redist.x86.exe'

/**
 * Story 074 D6, step 1: the wizard's engine choice. Story 080 D2: `BOOTSTRAP_SUPPORTED_ENGINES`
 * now names two engines (Q2PRO, R1Q2), so this renders every entry in `options` as its own
 * selectable row rather than a single pre-selected confirmation - each keeps a stable
 * `data-testid="bootstrap-engine-<engine>"` (so `bootstrap-engine-q2pro` keeps working) and shows
 * a check mark only on the row matching `selected`. An empty `options` array (the manifest pinned
 * nothing this wizard can offer) is a dead end shown as an empty state, not a step the user can
 * push past.
 */
export function EngineStep({
  options,
  selected,
  onSelect,
}: {
  options: BootstrapEngineOption[] | null
  selected: EngineKind | null
  onSelect: (engine: EngineKind) => void
}) {
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

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-ink-muted">{t('bootstrapWizard.engine.body')}</p>
      <div className="space-y-2">
        {options.map((option) => {
          const isSelected = option.engine === selected
          return (
            <button
              key={option.engine}
              type="button"
              onClick={() => onSelect(option.engine)}
              aria-pressed={isSelected}
              data-testid={`bootstrap-engine-${option.engine}`}
              className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-colors ${
                isSelected
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
                  {engineLabel(option.engine)}
                </p>
                <p className="text-xs text-ink-muted">
                  {t('bootstrapWizard.engine.version', { version: option.version })}
                </p>
              </div>
            </button>
          )
        })}
      </div>
      {selected === 'r1q2' && <R1q2Notice />}
    </div>
  )
}

/**
 * Story 080 D3 (AC8): shown only while R1Q2 is the selected option - the exact upstream source
 * this build is pinned to, the license it ships under (and that its text is installed alongside
 * the game files), and the x86 runtime prerequisite the bootstrap cannot install for the user.
 * Never claims the community mirror is published (it is not, as of this story) and never hosts or
 * downloads the engine's source tree itself - only points at it.
 */
function R1q2Notice() {
  const { t } = useTranslation()

  return (
    <Panel className="space-y-2 p-3" data-testid="bootstrap-engine-r1q2-notice">
      <p className="text-xs leading-relaxed text-ink-muted">
        {t('bootstrapWizard.engine.r1q2Notice.source')}{' '}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-flame-400 underline underline-offset-2 hover:text-flame-300"
          onClick={() => void invoke('app:openExternal', R1Q2_SOURCE_TREE_URL)}
        >
          {R1Q2_SOURCE_TREE_URL}
          <ExternalLink className="size-3" />
        </button>
      </p>
      <p className="text-xs leading-relaxed text-ink-muted">
        {t('bootstrapWizard.engine.r1q2Notice.license')}
      </p>
      <p className="text-xs leading-relaxed text-ink-muted">
        {t('bootstrapWizard.engine.r1q2Notice.runtime')}{' '}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-flame-400 underline underline-offset-2 hover:text-flame-300"
          onClick={() => void invoke('app:openExternal', VC_REDIST_X86_URL)}
        >
          {VC_REDIST_X86_URL}
          <ExternalLink className="size-3" />
        </button>
      </p>
    </Panel>
  )
}

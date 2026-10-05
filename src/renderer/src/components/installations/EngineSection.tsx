import { useTranslation } from 'react-i18next'
import { engineLabel, type DetectedEngine, type EngineKind } from '@shared/types/engine'
import type { Installation } from '@shared/types'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { SectionLabel } from '../ui/primitives'

interface EngineChoice {
  kind: EngineKind
  /** Present only for an engine detected in the folder; absent for the stored-but-gone one. */
  detected?: DetectedEngine
  /** i18n key + params of why this engine cannot be picked. */
  reason?: { key: string; params?: Record<string, string> }
}

function basename(path: string | undefined): string {
  return path?.split(/[\\/]/).pop() ?? ''
}

/**
 * Which of the engines found in the installation folder Play starts (story 246). The stored
 * choice stays listed even when its executable is gone, selected and disabled with the reason as
 * visible text, so the card never hides why the choice cannot launch.
 */
export function EngineSection({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  const updateInstallation = useLauncher((state) => state.updateInstallation)

  const detected = installation.detectedEngines ?? []
  // `custom`/`unknown` name no client: the stored executable is none of the chips, so nothing is
  // checked and nothing is reported missing.
  const chosenIsClient =
    installation.engineKind !== 'custom' && installation.engineKind !== 'unknown'
  const chosenMissing =
    chosenIsClient && !detected.some((engine) => engine.kind === installation.engineKind)
  if (detected.length < 2 && !(chosenMissing && detected.length > 0)) return null

  const choices: EngineChoice[] = detected.map((engine) => ({
    kind: engine.kind,
    detected: engine,
    reason: engine.supported ? undefined : { key: 'installation.engineChoice.unsupported' },
  }))
  if (chosenMissing) {
    choices.push({
      kind: installation.engineKind,
      reason: {
        key: 'installation.engineChoice.missing',
        params: { executable: basename(installation.executablePath) },
      },
    })
  }

  const reasonId = (kind: EngineKind) => `installation-engine-reason-${installation.id}-${kind}`
  const withReason = choices.filter((choice) => choice.reason)

  return (
    <div
      id={`installation-engine-${installation.id}`}
      data-testid="installation-engine"
      tabIndex={-1}
      className="space-y-2 border-t border-line pt-3 outline-none"
    >
      <SectionLabel>{t('common.label.engine')}</SectionLabel>

      <div
        role="radiogroup"
        aria-label={t('common.label.engine')}
        className="flex flex-wrap gap-1.5"
      >
        {choices.map((choice) => {
          const selected = choice.kind === installation.engineKind
          return (
            <button
              key={choice.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={choice.reason !== undefined}
              aria-describedby={choice.reason ? reasonId(choice.kind) : undefined}
              data-testid={`installation-engine-option-${choice.kind}`}
              onClick={() => void updateInstallation({ id: installation.id, engine: choice.kind })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                'transition-colors duration-[--dur-fast]',
                'disabled:pointer-events-none disabled:opacity-60',
                selected
                  ? 'border-flame-600 bg-flame-900/30 text-flame-200'
                  : 'border-line-strong bg-raised text-ink-dim hover:border-line-strong hover:text-ink',
              )}
            >
              {engineLabel(choice.kind)}
            </button>
          )
        })}
      </div>

      {withReason.length > 0 && (
        <div className="space-y-0.5">
          {withReason.map((choice) => (
            <p
              key={choice.kind}
              id={reasonId(choice.kind)}
              className="pl-0.5 text-[11px] leading-relaxed text-ink-muted"
              data-testid={`installation-engine-reason-${choice.kind}`}
            >
              <span className="font-medium">{engineLabel(choice.kind)}</span>
              {': '}
              {t(choice.reason!.key, choice.reason!.params ?? {})}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

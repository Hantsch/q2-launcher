import { useTranslation } from 'react-i18next'
import { engineLabel, type DetectedEngine, type EngineKind } from '@shared/types/engine'
import type { Installation } from '@shared/types'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { SectionLabel } from '../ui/primitives'

interface EngineChoice {
  kind: EngineKind
  /** Set only for one build of an engine that ships several clients. */
  build?: string
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
  const clientsOf = (engine: DetectedEngine) => engine.executablePaths ?? [engine.executablePath]
  const clientCount = detected.reduce((sum, engine) => sum + clientsOf(engine).length, 0)
  if (clientCount < 2 && !(chosenMissing && detected.length > 0)) return null

  const choices: EngineChoice[] = detected.flatMap((engine) => {
    const paths = clientsOf(engine)
    return paths.map((path) => ({
      kind: engine.kind,
      build: paths.length > 1 ? basename(path) : undefined,
      detected: engine,
      reason: engine.supported ? undefined : { key: 'installation.engineChoice.unsupported' },
    }))
  })
  if (chosenMissing) {
    choices.push({
      kind: installation.engineKind,
      reason: {
        key: 'installation.engineChoice.missing',
        params: { executable: basename(installation.executablePath) },
      },
    })
  }

  const suffix = (choice: EngineChoice) =>
    choice.build ? `${choice.kind}-${choice.build}` : choice.kind
  const reasonId = (choice: EngineChoice) =>
    `installation-engine-reason-${installation.id}-${suffix(choice)}`
  const label = (choice: EngineChoice) =>
    choice.build ? `${engineLabel(choice.kind)} · ${choice.build}` : engineLabel(choice.kind)
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
          const selected =
            choice.kind === installation.engineKind &&
            (choice.build === undefined ||
              choice.build.toLowerCase() === basename(installation.executablePath).toLowerCase())
          return (
            <button
              key={suffix(choice)}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={choice.reason !== undefined}
              aria-describedby={choice.reason ? reasonId(choice) : undefined}
              data-testid={`installation-engine-option-${suffix(choice)}`}
              onClick={() =>
                void updateInstallation({
                  id: installation.id,
                  engine: choice.kind,
                  ...(choice.build ? { engineExecutable: choice.build } : {}),
                })
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                'transition-colors duration-[--dur-fast]',
                'disabled:pointer-events-none disabled:opacity-60',
                selected
                  ? 'border-flame-600 bg-flame-900/30 text-flame-200'
                  : 'border-line-strong bg-raised text-ink-dim hover:border-line-strong hover:text-ink',
              )}
            >
              {label(choice)}
            </button>
          )
        })}
      </div>

      {withReason.length > 0 && (
        <div className="space-y-0.5">
          {withReason.map((choice) => (
            <p
              key={suffix(choice)}
              id={reasonId(choice)}
              className="pl-0.5 text-[11px] leading-relaxed text-ink-muted"
              data-testid={`installation-engine-reason-${suffix(choice)}`}
            >
              <span className="font-medium">{label(choice)}</span>
              {': '}
              {t(choice.reason!.key, choice.reason!.params ?? {})}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

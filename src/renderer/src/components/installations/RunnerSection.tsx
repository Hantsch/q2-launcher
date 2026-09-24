import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RunnerOption } from '@shared/ipc'
import {
  NATIVE_RUNNER_CHOICE,
  STEAM_APP_CLIENTS,
  type Installation,
  type LaunchPlan,
  type Outcome,
} from '@shared/types'
import { cn } from '../../lib/cn'
import { invoke } from '../../lib/bridge'
import { useLauncher } from '../../store/useLauncher'
import { Select } from '../ui/controls'
import { SectionLabel } from '../ui/primitives'

/**
 * Story 103 D7: which runner (native, or a Windows-compatibility layer found on a Linux host)
 * launches this installation's executable, and the resolved command that choice produces.
 *
 * First implementation in the app of CLAUDE.md's platform-parity rule: an unavailable runner is
 * never hidden - it stays in the list, `disabled`, with its reason rendered as visible text right
 * under its label (not a `title`-only tooltip, which a screen reader and a glance both miss).
 *
 * Story 104 D5: now rendered on every platform, including `win32` - Steam (D3) is a real runner
 * choice there too (`detectRunners()` returns `[native, steam]` on Windows), so a Windows host has
 * an actual pick to make, not the single permanently-selected `native` option 103 shipped with.
 */
export function RunnerSection({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  const platform = useLauncher((state) => state.appInfo?.platform)
  const updateInstallation = useLauncher((state) => state.updateInstallation)
  const steamClientSelectId = useId()

  const [runnersResult, setRunnersResult] = useState<Outcome<RunnerOption[]> | null>(null)
  const [planResult, setPlanResult] = useState<Outcome<LaunchPlan> | null>(null)

  // `installation.runner` and `installation.steamClient` are both dependencies (not just
  // `installation.id`) so the preview re-fetches whenever the effective runner choice OR the
  // chosen Steam client changes: `updateInstallation` writes either via `installations:update`,
  // the main process pushes a fresh `installations:changed` list, and the store hands this
  // component a new `installation` object with the new value (see LibraryView, which renders this
  // component from `state.installations`). Without `steamClient` here, picking a different Steam
  // client (D5's "refreshes the preview") would leave the previous client's URL on screen until
  // something unrelated remounted the component.
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
  }, [installation.id, installation.runner, installation.steamClient])

  // Platform unknown (appInfo not loaded yet): render nothing rather than guessing.
  if (platform === undefined) return null

  const runners = runnersResult?.ok ? runnersResult.value : []
  // Mirrors `resolveRunner()`'s own default (`src/main/services/runners.ts`) ONLY on win32: a
  // fresh Windows installation has no stored `runner` until a user actively picks one, and that
  // "no choice yet" state resolves to native there. Off win32, `resolveRunner()`'s unset-choice
  // default depends on `executableKind` (wine vs. umu vs. native) - defaulting to native here too
  // would show the wrong option checked against the preview below it, so this stays unset exactly
  // as it did before story 104 (no D5 requirement covers the off-win32 default).
  const effectiveRunner =
    installation.runner ?? (platform === 'win32' ? NATIVE_RUNNER_CHOICE : undefined)
  const steamOption = runners.find((option) => option.kind === 'steam')
  const steamSelected = steamOption !== undefined && effectiveRunner === steamOption.id
  const steamClientTable = installation.steamAppId
    ? STEAM_APP_CLIENTS[installation.steamAppId]
    : undefined

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
        <>
          {/* Story 105 D2: one wrapping row of inline chips, not full-width stacked buttons - the
              reasons for any unavailable options live below the row (not per-chip), each linked
              back to its chip via `aria-describedby` so a screen reader still announces it. */}
          <div role="radiogroup" aria-label={t('runner.heading')} className="flex flex-wrap gap-1.5">
            {runners.map((option) => (
              <RunnerChip
                key={`${option.kind}-${option.id}`}
                option={option}
                selected={effectiveRunner === option.id}
                reasonId={`installation-runner-reason-${installation.id}-${option.kind}`}
                onSelect={() =>
                  void updateInstallation({ id: installation.id, runner: option.id })
                }
              />
            ))}
          </div>

          {runners.some((option) => !option.available && option.reasonKey) && (
            <div className="space-y-0.5">
              {runners
                .filter((option) => !option.available && option.reasonKey)
                .map((option) => (
                  // Platform-parity rule (CLAUDE.md): the reason is visible text, not only a
                  // `title` tooltip - a screen reader and a glance both miss that. AC1: Proton's
                  // reason text carries the detected build count via `reasonParams.count` -
                  // `t()` resolves the i18next plural key from it.
                  <p
                    key={option.kind}
                    id={`installation-runner-reason-${installation.id}-${option.kind}`}
                    className="pl-0.5 text-[11px] leading-relaxed text-ink-muted"
                    data-testid={`installation-runner-reason-${option.kind}`}
                  >
                    {t(option.reasonKey as string, option.reasonParams ?? {})}
                  </p>
                ))}
            </div>
          )}
        </>
      )}

      {/* Story 104 D5, revised by 105 D2 AC3: Steam is not a real runner in the way native/wine/umu
          are - it hands the launch off to another process entirely - but the caveat now follows
          the *choice*, not just the option's presence in the list: it is shown only while Steam is
          the selected runner, not for every visitor who merely sees Steam listed (and unavailable,
          Steam already gets its own short disabled reason from the block above). */}
      {steamOption && steamSelected && (
        <p
          className="pl-2.5 text-[11px] leading-relaxed text-ink-muted"
          data-testid="installation-runner-steam-caveat"
        >
          {t('runner.steam.caveat')}
        </p>
      )}

      {steamOption && steamSelected && steamClientTable && (
        <div className="flex items-center gap-2">
          {/* Mirrors `EngineScopeSelect.tsx`'s label/control pairing: a sibling `<label>` with
              `htmlFor` pointing at the `Select`'s own `id`, rather than an unassociated `<span>` -
              the same fix story 037 D6 made for `Field`. */}
          <label className="stencil text-[9px]" htmlFor={steamClientSelectId}>
            {t('runner.steam.client.label')}
          </label>
          <Select
            id={steamClientSelectId}
            data-testid="installation-runner-steam-client"
            className="h-7 w-56 text-xs"
            value={String(installation.steamClient ?? steamClientTable.defaultIndex)}
            onChange={(event) =>
              void updateInstallation({
                id: installation.id,
                steamClient: Number(event.target.value),
              })
            }
            options={steamClientTable.clients.map((client) => ({
              value: String(client.index),
              label: t(client.labelKey),
            }))}
          />
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

function RunnerChip({
  option,
  selected,
  reasonId,
  onSelect,
}: {
  option: RunnerOption
  selected: boolean
  reasonId: string
  onSelect: () => void
}) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!option.available}
      aria-describedby={!option.available && option.reasonKey ? reasonId : undefined}
      data-testid={`installation-runner-option-${option.kind}`}
      onClick={onSelect}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        'transition-colors duration-[--dur-fast]',
        'disabled:pointer-events-none disabled:opacity-60',
        selected
          ? 'border-flame-600 bg-flame-900/30 text-flame-200'
          : 'border-line-strong bg-raised text-ink-dim hover:border-line-strong hover:text-ink',
      )}
    >
      {t(option.labelKey)}
    </button>
  )
}

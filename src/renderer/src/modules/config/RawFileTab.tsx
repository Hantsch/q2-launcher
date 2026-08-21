import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ExternalLink, FolderOpen } from 'lucide-react'
import type { ConfigProfile, RawFilesResult } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { Button, IconButton } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/controls'
import { Badge, SectionLabel, Spinner } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { getRawFiles, openProfileFile, setPlayedMods } from './client'
import { ConfigCodeView } from './components/ConfigCodeView'
import { RawConfigPanel } from './RawConfigPanel'

/**
 * Raw File tab (story 023): replaces the old Write targets + Raw file split.
 * Always shows the profile's own canonical file first - even for a profile
 * assigned nowhere (AC 3) - then one row per assigned installation (D5),
 * each expandable into `RawConfigPanel` for that installation's rendered
 * files.
 *
 * Module-local, props-based, same idiom as `RawConfigPanel`: owns its own
 * fetch, no shell-store dependency beyond `pushToast` for action failures.
 */
export function RawFileTab({ profile }: { profile: ConfigProfile }) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const installations = useLauncher((state) => state.installations)

  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<Outcome<RawFilesResult> | null>(null)
  const [expandedInstallationId, setExpandedInstallationId] = useState<string | null>(null)

  /**
   * Played-mods overrides, keyed by installation id. Unlike the old
   * `WriteTargets.tsx` (which started this map empty with no getter to seed
   * from), `target.playedMods` below is always read as the fallback when an
   * installation has no override yet, so a row always reflects the
   * persisted selection on first render - the map here only exists to
   * reflect a toggle's confirmed round-trip immediately, without waiting for
   * the next `getRawFiles` fetch.
   */
  const [playedModsOverride, setPlayedModsOverride] = useState<Record<string, string[]>>({})

  // `assign`/`unassign`/`setDefault` change which installations this profile is assigned to
  // WITHOUT bumping `updatedAt` (deliberately - see `assignments.ts`'s own file doc comment), so a
  // plain `profile.updatedAt` dependency alone misses exactly those three changes - a newly
  // assigned installation would just be missing from `rows` until something else re-triggers a
  // fetch. This key changes whenever the *set* of assigned installations changes, independent of
  // `updatedAt`.
  const assignmentKey = profile.assignments
    .map((assignment) => assignment.installationId)
    .sort()
    .join(',')

  // Re-reads on a profile switch AND on a save (`updatedAt` bump) - AC 7:
  // "switching profiles or installations re-reads the file rather than
  // showing a stale copy".
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setResult(null)
    void getRawFiles({ profileId: profile.id }).then((outcome) => {
      if (cancelled) return
      setResult(outcome)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [profile.id, profile.updatedAt, assignmentKey])

  const openFile = async (installationId: string | null, mode: 'open' | 'reveal'): Promise<void> => {
    const outcome = await openProfileFile({ profileId: profile.id, installationId, mode })
    if (!outcome.ok) {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
    }
  }

  const togglePlayedMod = async (
    installationId: string,
    currentMods: string[],
    mod: string,
    checked: boolean,
  ): Promise<void> => {
    const next = checked ? [...currentMods, mod] : currentMods.filter((entry) => entry !== mod)
    const outcome = await setPlayedMods({ installationId, playedMods: next })
    if (outcome.ok) {
      setPlayedModsOverride((prev) => ({ ...prev, [installationId]: outcome.value }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    )
  }

  if (result && !result.ok) {
    return <p className="text-sm text-danger">{t(result.error.key, result.error.params)}</p>
  }

  if (!result) return null

  const { canonical, installations: targets } = result.value

  const rows = profile.assignments
    .map((assignment) => {
      const installation = installations.find((inst) => inst.id === assignment.installationId)
      const target = targets.find((entry) => entry.installationId === assignment.installationId)
      return installation && target ? { installation, target } : null
    })
    .filter((row): row is { installation: (typeof installations)[number]; target: (typeof targets)[number] } => row !== null)

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionLabel>{t('config.raw.own')}</SectionLabel>
        <div className="flex items-center gap-2">
          <p
            className="numeric min-w-0 flex-1 truncate text-xs text-ink-dim"
            title={canonical.path}
            data-selectable
          >
            {canonical.path}
          </p>
          <Badge tone={canonical.onDisk ? 'success' : 'neutral'}>
            {canonical.onDisk ? t('config.raw.onDisk') : t('config.raw.notOnDisk')}
          </Badge>
          <IconButton
            label={t('config.raw.openEditor')}
            size="sm"
            disabled={!canonical.onDisk}
            onClick={() => void openFile(null, 'open')}
          >
            <ExternalLink className="size-3.5" />
          </IconButton>
          <IconButton
            label={t('config.raw.reveal')}
            size="sm"
            disabled={!canonical.onDisk}
            onClick={() => void openFile(null, 'reveal')}
          >
            <FolderOpen className="size-3.5" />
          </IconButton>
        </div>
        {!canonical.onDisk && (
          <p className="text-xs text-ink-muted">{t('config.raw.ownNotOnDisk')}</p>
        )}
        <ConfigCodeView text={canonical.content} searchable />
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('config.assignment.noInstallations')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ installation, target }) => {
            const expanded = expandedInstallationId === installation.id
            const tone = !target.onDisk ? 'neutral' : target.matches ? 'success' : 'warning'
            const statusKey = !target.onDisk
              ? 'config.raw.notOnDisk'
              : target.matches
                ? 'config.raw.present'
                : 'config.raw.differs'
            const mods = installation.gameDirs.filter((dir) => dir.toLowerCase() !== 'baseq2')
            const checkedMods = playedModsOverride[installation.id] ?? target.playedMods

            return (
              <li
                key={installation.id}
                className="space-y-2 rounded-sm border border-line px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {installation.name}
                  </span>
                  <Badge tone={tone}>{t(statusKey)}</Badge>
                  <IconButton
                    label={t('config.raw.openEditor')}
                    size="sm"
                    disabled={!target.onDisk}
                    onClick={() => void openFile(installation.id, 'open')}
                  >
                    <ExternalLink className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.raw.reveal')}
                    size="sm"
                    disabled={!target.onDisk}
                    onClick={() => void openFile(installation.id, 'reveal')}
                  >
                    <FolderOpen className="size-3.5" />
                  </IconButton>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('config.raw.expand')}
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedInstallationId(expanded ? null : installation.id)
                    }
                  >
                    {expanded ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </Button>
                </div>
                <p
                  className="numeric min-w-0 truncate text-xs text-ink-dim"
                  title={target.path}
                  data-selectable
                >
                  {target.path}
                </p>
                {!target.onDisk && (
                  <p className="text-xs text-ink-muted">{t('config.raw.notWritten')}</p>
                )}
                <div className="space-y-1">
                  <span className="stencil">{t('config.raw.playedMods')}</span>
                  {mods.length === 0 ? (
                    <p className="text-xs text-ink-muted">{t('config.raw.noMods')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {mods.map((mod) => (
                        <Checkbox
                          key={mod}
                          checked={checkedMods.includes(mod)}
                          onChange={(next) =>
                            void togglePlayedMod(installation.id, checkedMods, mod, next)
                          }
                          label={mod}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {expanded && <RawConfigPanel profile={profile} installationId={installation.id} />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

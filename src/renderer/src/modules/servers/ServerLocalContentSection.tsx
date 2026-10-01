import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck, Download } from 'lucide-react'
import {
  mapLookupTarget,
  serverModStatus,
  type CatalogGameDirEntry,
} from '@shared/mods/server-local-content'
import { isJobActive, type LocalizedMessage } from '@shared/types'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { useActiveInstallation, useLauncher } from '../../store/useLauncher'
import {
  InstallDecisionDialog,
  type InstallDecisionRequest,
} from '../mods/components/InstallDecisionDialog'
import { getCatalog, getMapPresence, installMod, listMods, onInstallDecision } from '../mods/client'

export interface ServerLocalContentSectionProps {
  /** The server's mod as the detail header shows it (`row.mod ?? serverinfo.gamedir ?? serverinfo.game`). */
  mod: string | undefined
  map: string | undefined
}

function Statement({
  testId,
  state,
  good,
  children,
}: {
  testId: string
  state: string
  good: boolean
  children: string
}) {
  const Icon = good ? CircleCheck : CircleAlert
  return (
    <p
      className="flex min-w-0 items-center gap-2 text-sm text-ink"
      data-testid={testId}
      data-state={state}
      data-selectable
    >
      <Icon
        className={cn('size-4 shrink-0', good ? 'text-success' : 'text-warning')}
        aria-hidden="true"
      />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

/**
 * Story 192 D3: what the server's mod and map mean for the active installation - do I have the mod,
 * do I have the map. The mod statement is pure (names in `installation.gameDirs`); the map statement
 * comes from the main process (`mods:map.presence`) and stays absent until a lookup for exactly this
 * server has answered, so a stale or failed answer never shows a wrong state. Server-supplied names
 * are rendered as text only; an unsafe gamedir never reaches a path (the lookup then omits it).
 */
export function ServerLocalContentSection({ mod, map }: ServerLocalContentSectionProps) {
  const { t } = useTranslation()
  const installation = useActiveInstallation()
  const installationId = installation?.id ?? null
  const gameDirsKey = installation ? installation.gameDirs.join('\n') : ''

  const jobs = useLauncher((s) => s.jobs)

  // The catalog is read once; unavailable, failed or rejected all mean "no catalog" (no Install).
  const [catalogEntries, setCatalogEntries] = useState<CatalogGameDirEntry[] | null>(null)
  useEffect(() => {
    let stale = false
    getCatalog()
      .then((outcome) =>
        outcome.ok && outcome.value.status === 'ok'
          ? outcome.value.entries.map((e) => ({ id: e.id, gameDir: e.gamedir }))
          : null,
      )
      .catch(() => null)
      .then((entries) => {
        if (!stale) setCatalogEntries(entries)
      })
    return () => {
      stale = true
    }
  }, [])

  // Installs started here (installation + catalog id -> job id), refusals, and a pending decision.
  const [started, setStarted] = useState<{
    installationId: string
    catalogId: string
    jobId: string
  } | null>(null)
  const [failure, setFailure] = useState<LocalizedMessage | null>(null)
  const [decision, setDecision] = useState<InstallDecisionRequest | null>(null)
  const [answered, setAnswered] = useState<string[]>([])
  // An install of this mod running from elsewhere (e.g. the Mods view) also keeps the button busy.
  const [elsewhere, setElsewhere] = useState<{ installationId: string; jobIds: string[] } | null>(
    null,
  )

  useEffect(
    () =>
      onInstallDecision((event) => {
        if (event.installationId === installationId) setDecision(event)
      }),
    [installationId],
  )

  const status = useMemo(
    () =>
      serverModStatus({
        serverMod: mod,
        gameDirs: gameDirsKey === '' ? [] : gameDirsKey.split('\n'),
        catalog: catalogEntries,
      }),
    [mod, gameDirsKey, catalogEntries],
  )
  const installCatalogId = status.kind === 'missing' ? status.catalogId : null

  useEffect(() => {
    if (installationId === null || installCatalogId === null) return
    let stale = false
    void listMods(installationId).then((outcome) => {
      if (stale || !outcome.ok) return
      setElsewhere({
        installationId,
        jobIds: outcome.value.activeInstalls
          .filter((a) => a.catalogId === installCatalogId)
          .map((a) => a.jobId),
      })
    })
    return () => {
      stale = true
    }
  }, [installationId, installCatalogId])

  const trackedJobIds = [
    ...(started && started.installationId === installationId && started.catalogId === installCatalogId
      ? [started.jobId]
      : []),
    ...(elsewhere && elsewhere.installationId === installationId ? elsewhere.jobIds : []),
  ]
  const installing = jobs.some((j) => trackedJobIds.includes(j.id) && isJobActive(j))

  const startInstall = async (): Promise<void> => {
    if (installationId === null || installCatalogId === null) return
    setFailure(null)
    const outcome = await installMod(installationId, installCatalogId)
    if (outcome.ok) setStarted({ installationId, catalogId: installCatalogId, jobId: outcome.value.jobId })
    else setFailure(outcome.error)
  }
  const statusGameDir = status.kind === 'base' ? '' : status.gameDir
  const target = useMemo(() => mapLookupTarget(status, map), [status, map])
  const lookupKey =
    installationId !== null && target !== null
      ? JSON.stringify([installationId, target.gameDir ?? null, target.map])
      : null

  const [answer, setAnswer] = useState<{ key: string; available: boolean } | null>(null)

  useEffect(() => {
    if (installationId === null || target === null || lookupKey === null) return
    let cancelled = false
    void getMapPresence({ installationId, ...target }).then((result) => {
      if (cancelled || !result.ok) return
      setAnswer({ key: lookupKey, available: result.value.available })
    })
    return () => {
      cancelled = true
    }
    // `target` is derived from exactly these inputs; `lookupKey` stands for it.
  }, [installationId, gameDirsKey, statusGameDir, map, lookupKey])

  if (installation === null) {
    return (
      <div className="space-y-1" data-testid="servers-detail-local-content">
        <p className="text-sm text-ink-muted" data-testid="servers-detail-local-content-no-installation">
          {t('servers.detail.localContent.noInstallation')}
        </p>
      </div>
    )
  }

  const mapAvailable = answer !== null && answer.key === lookupKey ? answer.available : null

  return (
    <div className="space-y-1.5" data-testid="servers-detail-local-content">
      {status.kind !== 'base' && (
        <Statement
          testId="servers-detail-mod-status"
          state={status.kind === 'installed' ? 'installed' : 'missing'}
          good={status.kind === 'installed'}
        >
          {status.kind === 'installed'
            ? t('servers.detail.localContent.modInstalled')
            : t('servers.detail.localContent.modMissing')}
        </Statement>
      )}
      {installCatalogId !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<Download className="size-3.5" aria-hidden="true" />}
            disabled={installing}
            onClick={() => void startInstall()}
            data-testid="servers-detail-mod-install"
          >
            {installing
              ? t('servers.detail.localContent.installing')
              : t('servers.detail.localContent.install')}
          </Button>
          {failure && (
            <p role="alert" className="text-sm text-danger" data-testid="servers-detail-mod-install-error">
              {t(failure.key, failure.params)}
            </p>
          )}
        </div>
      )}
      {mapAvailable !== null && (
        <Statement
          testId="servers-detail-map-status"
          state={mapAvailable ? 'available' : 'missing'}
          good={mapAvailable}
        >
          {mapAvailable
            ? t('servers.detail.localContent.mapAvailable')
            : t('servers.detail.localContent.mapMissing')}
        </Statement>
      )}
      {decision && !answered.includes(decision.jobId) && (
        <InstallDecisionDialog
          request={decision}
          onAnswered={(jobId) => {
            setAnswered((prev) => [...prev, jobId])
            setDecision(null)
          }}
        />
      )}
    </div>
  )
}

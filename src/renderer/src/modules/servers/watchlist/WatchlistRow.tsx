import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Outcome } from '@shared/types'
import {
  WATCHLIST_NAME_MAX,
  type ServerListRow,
  type WatchlistEntryStatus,
  type WatchlistMatch,
  type WatchlistMatchMode,
} from '@shared/modules/servers'
import type { ScanStartResult } from '@shared/modules/servers'
import { formatRelativeTime } from '../../../lib/format'
import { Button, IconButton } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/controls'
import { Pencil, PanelRight, Trash2 } from 'lucide-react'
import type { WatchlistMutationResult } from '../client'
import { WatchlistMatchRow } from './WatchlistMatchRow'

const MODE_OPTIONS: { value: WatchlistMatchMode; labelKey: string }[] = [
  { value: 'exact', labelKey: 'servers.watchlist.mode.exact' },
  { value: 'substring', labelKey: 'servers.watchlist.mode.substring' },
  { value: 'regex', labelKey: 'servers.watchlist.mode.regex' },
]

export interface WatchlistRowProps {
  status: WatchlistEntryStatus
  /** The panel-level snapshot's `asOf`, used for the `offline` state's "not found in data from…"
   * line - the row itself has no notion of "as of" beyond what the panel passes down. */
  asOf: string | null
  update: (input: {
    id: string
    name: string
    mode: WatchlistMatchMode
  }) => Promise<Outcome<WatchlistMutationResult>>
  remove: (id: string) => Promise<Outcome<WatchlistMutationResult>>
  recheck: (id: string) => Promise<Outcome<ScanStartResult>>
  renderMatchActions: (match: WatchlistMatch) => ReactNode
  /** The server list's live row for an address, shown as the match's server stats. */
  resolveServer: (address: string) => ServerListRow | undefined
  /** The address open in the watchlist's detail pane, highlighted among the matches. */
  selectedAddress: string | null
}

/**
 * Story 132 D2: one watchlist entry's row. Never mentions "spectate"/"spectating"/"playing"
 * anywhere in its own text or attributes (AC4) - a match shows name/score/ping/seen-time only, the
 * caller-supplied `renderMatchActions` is the only place any join/spectate affordance can appear.
 */
export function WatchlistRow({
  status,
  asOf,
  update,
  remove,
  recheck,
  renderMatchActions,
  resolveServer,
  selectedAddress,
}: WatchlistRowProps) {
  const { t } = useTranslation()
  const modeOptions = MODE_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))
  const { entry, state } = status

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(entry.name)
  const [editMode, setEditMode] = useState<WatchlistMatchMode>(entry.mode)
  const [editErrorKey, setEditErrorKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [recheckErrorKey, setRecheckErrorKey] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)

  const startEdit = (): void => {
    setEditName(entry.name)
    setEditMode(entry.mode)
    setEditErrorKey(null)
    setEditing(true)
  }

  const cancelEdit = (): void => setEditing(false)

  const saveEdit = async (): Promise<void> => {
    if (editName.trim().length === 0) return
    setSaving(true)
    const result = await update({ id: entry.id, name: editName, mode: editMode })
    setSaving(false)
    if (!result.ok) {
      setEditErrorKey(result.error.key)
      return
    }
    if (!result.value.ok) {
      setEditErrorKey(result.value.reasonKey)
      return
    }
    setEditErrorKey(null)
    setEditing(false)
  }

  const handleRemove = (): void => {
    void remove(entry.id)
  }

  const handleRecheck = async (): Promise<void> => {
    setRechecking(true)
    const result = await recheck(entry.id)
    setRechecking(false)
    if (!result.ok) {
      setRecheckErrorKey(result.error.key)
      return
    }
    if (!result.value.ok) {
      setRecheckErrorKey(result.value.reasonKey)
      return
    }
    setRecheckErrorKey(null)
  }

  return (
    <div
      data-testid={`servers-watchlist-row-${entry.id}`}
      data-state={state}
      className="space-y-2 rounded-sm border border-line-strong bg-raised px-3 py-2"
    >
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              maxLength={WATCHLIST_NAME_MAX}
              className="h-7 min-w-0 flex-1 rounded-sm border border-line-strong bg-void/60 px-2 text-xs text-ink"
              data-testid={`servers-watchlist-edit-name-${entry.id}`}
            />
            <Select
              value={editMode}
              onChange={(event) => setEditMode(event.target.value as WatchlistMatchMode)}
              options={modeOptions}
              className="h-7 w-28 text-xs"
              data-testid={`servers-watchlist-edit-mode-${entry.id}`}
            />
            <Button
              size="sm"
              variant="neutral"
              onClick={() => void saveEdit()}
              disabled={saving || editName.trim().length === 0}
              data-testid={`servers-watchlist-edit-save-${entry.id}`}
            >
              {t('servers.watchlist.edit.save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelEdit}
              disabled={saving}
              data-testid={`servers-watchlist-edit-cancel-${entry.id}`}
            >
              {t('servers.watchlist.edit.cancel')}
            </Button>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ink">{entry.name}</p>
            <p className="text-xs text-ink-muted">{t(`servers.watchlist.mode.${entry.mode}`)}</p>
          </div>
        )}

        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            {state === 'found' && (
              <IconButton
                label={t('servers.watchlist.recheck.label')}
                size="sm"
                variant="ghost"
                onClick={() => void handleRecheck()}
                disabled={rechecking || status.recheck === 'pending'}
                data-testid={`servers-watchlist-recheck-${entry.id}`}
              >
                <span aria-hidden="true">↻</span>
              </IconButton>
            )}
            <IconButton
              label={t('servers.watchlist.edit.label')}
              size="sm"
              variant="ghost"
              onClick={startEdit}
              data-testid={`servers-watchlist-edit-${entry.id}`}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t('servers.watchlist.remove.label')}
              size="sm"
              variant="ghost"
              onClick={handleRemove}
              data-testid={`servers-watchlist-remove-${entry.id}`}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </div>

      {editErrorKey && (
        <p
          role="alert"
          className="text-xs text-danger"
          data-testid={`servers-watchlist-edit-error-${entry.id}`}
        >
          {t(editErrorKey)}
        </p>
      )}

      {recheckErrorKey && (
        <p
          role="alert"
          className="text-xs text-danger"
          data-testid={`servers-watchlist-recheck-error-${entry.id}`}
        >
          {t(recheckErrorKey)}
        </p>
      )}

      {state === 'offline' && (
        <p className="text-xs text-ink-muted">
          {t('servers.watchlist.offline')}{' '}
          {asOf
            ? t('servers.watchlist.notFoundSince', { rel: formatRelativeTime(asOf) })
            : t('servers.watchlist.noData')}
        </p>
      )}

      {state === 'too-slow' && <p className="text-xs text-ink-muted">{t('servers.watchlist.tooSlow')}</p>}

      {state === 'left' && (
        <p className="text-xs text-ink-muted">
          {t(status.reasonKey)}{' '}
          {t('servers.watchlist.checkedAt', { rel: formatRelativeTime(status.checkedAt) })}
        </p>
      )}

      {state === 'found' && (
        <ul className="space-y-2">
          {status.matches.map((match) => (
            <WatchlistMatchRow
              key={match.address}
              entryId={entry.id}
              match={match}
              server={resolveServer(match.address)}
              selected={match.address === selectedAddress}
              actions={renderMatchActions(match)}
            />
          ))}
        </ul>
      )}

      {status.recheck === 'pending' && (
        <p className="text-xs text-ink-muted">{t('servers.watchlist.recheck.pending')}</p>
      )}
      {status.recheck === 'no-reply' && (
        <p className="text-xs text-ink-muted">{t('servers.watchlist.recheck.noReply')}</p>
      )}
    </div>
  )
}

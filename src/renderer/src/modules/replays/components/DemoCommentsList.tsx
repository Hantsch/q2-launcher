import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Play, X } from 'lucide-react'
import type { DemoRow } from '@shared/modules/replays'
import { formatPlaybackPosition } from '@shared/replays/timeline'
import { SIDECAR_LIMITS, type SidecarComment } from '@shared/replays/sidecar'
import { IconButton } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/controls'
import { useDemoEditorStore, type CommentEditResult, type RowPatcher } from '../demo-editor-store'
import { usePlaybackStore } from '../playback-store'
import { useDemoPlay } from '../useDemoPlay'

export interface DemoCommentsListProps {
  row: DemoRow
  onRowPatched: RowPatcher
}

/** One key per comment; equal time and text are allowed, so repeats carry their occurrence number. */
export function commentKeys(comments: readonly SidecarComment[]): string[] {
  const seen = new Map<string, number>()
  return comments.map((comment) => {
    const base = `${comment.atMs}-${comment.text}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}-${n}`
  })
}

export const commentFailureKey = (result: CommentEditResult): string =>
  result.status === 'refused' ? result.key : 'replays.comments.error.failed'

/**
 * The demo's time-anchored comments, sorted by time. A comment is edited in place (Enter or leaving
 * saves, Escape reverts) or deleted at once; every change goes through the editor store's queued
 * fresh-read write. A refused or failed change keeps the typed text and says why. (story 241)
 */
export function DemoCommentsList({ row, onRowPatched }: DemoCommentsListProps) {
  const { t } = useTranslation()
  const archived = row.archiveEntry !== null
  const comments = [...(row.sidecar.values.comments ?? [])].sort((a, b) => a.atMs - b.atMs)
  const keys = commentKeys(comments)
  const [editing, setEditing] = useState<{ key: string; comment: SidecarComment } | null>(null)
  const [draft, setDraft] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  // Escape unmounts the input; the blur that may follow must not save the discarded text.
  const discarding = useRef(false)
  const saving = useRef(false)
  const { eligibility, busy: playBusy, error: playError, play } = useDemoPlay(row)
  const playingHere = usePlaybackStore((state) => state.session?.demoId === row.id)
  const playReasonId = useId()
  // A session on this demo only seeks; otherwise the demo must be playable to start there.
  const playRefusal = !playingHere && eligibility !== null && !eligibility.ok ? eligibility : null
  const canPlay = playingHere || (eligibility !== null && eligibility.ok && !playBusy)

  const stopEditing = (): void => {
    setEditing(null)
    setErrorKey(null)
  }

  const save = async (): Promise<void> => {
    if (editing === null || saving.current || discarding.current) return
    if (draft === editing.comment.text) return stopEditing()
    if (draft.trim() === '') return setErrorKey('replays.comments.error.empty')
    saving.current = true
    try {
      const result = await useDemoEditorStore
        .getState()
        .commentEdit(
          row.id,
          { kind: 'edit', atMs: editing.comment.atMs, text: editing.comment.text, newText: draft },
          onRowPatched,
        )
      if (result.status === 'saved') stopEditing()
      else setErrorKey(commentFailureKey(result))
    } finally {
      saving.current = false
    }
  }

  const remove = async (comment: SidecarComment): Promise<void> => {
    const result = await useDemoEditorStore
      .getState()
      .commentEdit(row.id, { kind: 'remove', atMs: comment.atMs, text: comment.text }, onRowPatched)
    setErrorKey(result.status === 'saved' ? null : commentFailureKey(result))
  }

  const playFrom = async (comment: SidecarComment): Promise<void> => {
    const seconds = Math.floor(comment.atMs / 1000)
    if (!playingHere) return play(false, seconds)
    const refusal = await usePlaybackStore.getState().sendTimeline({ kind: 'seekTo', seconds })
    setErrorKey(refusal === null ? null : refusal.key)
  }

  return (
    <div className="space-y-1" data-testid="replays-detail-comments">
      <span className="text-sm text-ink-muted">{t('replays.comments.heading')}</span>
      {comments.length === 0 && (
        <p className="text-sm text-ink-faint" data-testid="replays-detail-comments-empty">
          {t('replays.comments.empty')}
        </p>
      )}
      <ul className="space-y-1">
        {comments.map((comment, index) => {
          const key = keys[index]!
          const time = formatPlaybackPosition(comment.atMs)
          const isEditing = editing?.key === key
          return (
            <li
              key={key}
              className="flex items-center gap-2 text-sm"
              data-testid="replays-detail-comment"
              data-at-ms={comment.atMs}
            >
              <span
                className="numeric w-14 shrink-0 text-ink-dim"
                data-testid="replays-comment-time"
              >
                {time}
              </span>
              {isEditing ? (
                <Input
                  autoFocus
                  value={draft}
                  maxLength={SIDECAR_LIMITS.comment}
                  aria-label={t('replays.comments.fieldLabel', { time })}
                  aria-invalid={errorKey !== null}
                  className="h-7 min-w-0 flex-1 text-sm"
                  data-testid="replays-comment-input"
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setErrorKey(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      discarding.current = true
                      stopEditing()
                    } else if (event.key === 'Enter') {
                      event.preventDefault()
                      void save()
                    }
                  }}
                  onBlur={() => void save()}
                />
              ) : (
                <span
                  className="min-w-0 flex-1 break-words text-ink"
                  data-testid="replays-comment-text"
                >
                  {comment.text}
                </span>
              )}
              {!isEditing && (
                <IconButton
                  label={t('replays.comments.playFromHere', { time })}
                  size="sm"
                  disabled={!canPlay}
                  aria-describedby={playRefusal !== null ? playReasonId : undefined}
                  data-testid="replays-detail-comment-play"
                  onClick={() => void playFrom(comment)}
                >
                  <Play className="size-3.5" aria-hidden="true" />
                </IconButton>
              )}
              {!archived && !isEditing && (
                <>
                  <IconButton
                    label={t('replays.comments.edit', { time })}
                    size="sm"
                    data-testid="replays-comment-edit"
                    onClick={() => {
                      discarding.current = false
                      setDraft(comment.text)
                      setErrorKey(null)
                      setEditing({ key, comment })
                    }}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={t('replays.comments.delete', { time })}
                    size="sm"
                    data-testid="replays-comment-delete"
                    onClick={() => void remove(comment)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </IconButton>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {errorKey !== null && (
        <p className="text-xs text-danger" role="alert" data-testid="replays-detail-comments-error">
          {t(errorKey)}
        </p>
      )}
      {playRefusal !== null && comments.length > 0 && (
        <p
          id={playReasonId}
          className="text-xs text-ink-dim"
          data-testid="replays-detail-comment-play-reason"
        >
          {t(playRefusal.reasonKey, playRefusal.params)}
        </p>
      )}
      {playError !== null && (
        <p
          className="text-xs text-danger"
          role="alert"
          data-testid="replays-detail-comment-play-error"
        >
          {t(playError.key, playError.params)}
        </p>
      )}
      {archived && (
        <p className="text-xs text-ink-dim" data-testid="replays-detail-comments-readonly">
          {t('replays.comments.archiveReadOnly')}
        </p>
      )}
    </div>
  )
}

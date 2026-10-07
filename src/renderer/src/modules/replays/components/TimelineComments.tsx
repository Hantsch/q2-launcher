import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIDECAR_LIMITS, type SidecarComment } from '@shared/replays/sidecar'
import { formatPlaybackPosition } from '@shared/replays/timeline'
import { Button, IconButton } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/controls'
import { cn } from '../../../lib/cn'
import { useDemoEditorStore, type RowPatcher } from '../demo-editor-store'
import { commentFailureKey, commentKeys } from './DemoCommentsList'

export interface CommentMarksProps {
  comments: readonly SidecarComment[]
  durationMs: number
  onSeek: (seconds: number) => void
  focusRing: string
}

/** Keeps a bubble near either end of the bar inside the strip instead of hanging off its side. */
function bubbleAlign(fraction: number): string {
  if (fraction < 0.2) return 'translate-x-0'
  if (fraction > 0.8) return '-translate-x-full'
  return '-translate-x-1/2'
}

/**
 * One mark per comment over the seek track. The layer is a sibling of the slider, never inside it,
 * so a mark's click cannot also reach the bar's own click seek. The bubble opens below the track:
 * the native game window covers everything above the strip. (story 241)
 */
export function CommentMarks({ comments, durationMs, onSeek, focusRing }: CommentMarksProps) {
  const { t } = useTranslation()
  const [active, setActive] = useState<SidecarComment | null>(null)
  const keys = commentKeys(comments)
  const fractionOf = (atMs: number): number => Math.min(1, atMs / durationMs)

  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-testid="replays-timeline-comment-marks"
    >
      {comments.map((comment, index) => (
        <IconButton
          key={keys[index]}
          size="sm"
          label={t('replays.comments.markLabel', {
            time: formatPlaybackPosition(comment.atMs),
            text: comment.text,
          })}
          // The bubble below is the tooltip; a native one would paint over the game window.
          title={undefined}
          className={cn(
            'pointer-events-auto absolute top-1/2 size-6! -translate-x-1/2 -translate-y-1/2 cursor-pointer',
            focusRing,
          )}
          style={{ left: `${fractionOf(comment.atMs) * 100}%` }}
          data-testid="replays-timeline-comment-mark"
          data-at-ms={comment.atMs}
          onMouseEnter={() => setActive(comment)}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(comment)}
          onBlur={() => setActive(null)}
          onClick={() => onSeek(Math.floor(comment.atMs / 1000))}
        >
          <span aria-hidden="true" className="h-3.5 w-0.5 rounded-full bg-ink" />
        </IconButton>
      ))}
      {active !== null && (
        <div
          aria-hidden="true"
          className={cn(
            'absolute top-full z-10 mt-1 max-w-96 rounded-sm border border-line-strong bg-panel px-2 py-1 text-xs text-ink shadow-md',
            bubbleAlign(fractionOf(active.atMs)),
          )}
          style={{ left: `${fractionOf(active.atMs) * 100}%` }}
          data-testid="replays-timeline-comment-bubble"
        >
          <span className="mr-1.5 text-ink-muted tabular-nums">
            {formatPlaybackPosition(active.atMs)}
          </span>
          <span className="line-clamp-2 break-words">{active.text}</span>
        </div>
      )}
    </div>
  )
}

export interface CommentFieldProps {
  demoId: string
  /** The position the comment is pinned to - taken at the Add click, not when the pause lands. */
  atMs: number
  onRowPatched: RowPatcher
  onClose: () => void
}

/**
 * The one-line field that adds a comment at `atMs`; it lives inside the strip, below the seek bar,
 * and keeps its row with the error inline so the strip's fixed height in stage mode holds. (story 241)
 */
export function CommentField({ demoId, atMs, onRowPatched, onClose }: CommentFieldProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const saving = useRef(false)
  const time = formatPlaybackPosition(atMs)

  const save = async (): Promise<void> => {
    if (saving.current) return
    const text = draft.trim()
    if (text === '') return setErrorKey('replays.comments.error.empty')
    saving.current = true
    try {
      const result = await useDemoEditorStore
        .getState()
        .commentEdit(demoId, { kind: 'add', atMs, text }, onRowPatched)
      if (result.status === 'saved') onClose()
      else setErrorKey(commentFailureKey(result))
    } finally {
      saving.current = false
    }
  }

  return (
    <div className="flex items-center gap-2" data-testid="replays-timeline-comment-form">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-sm text-ink-muted tabular-nums">
          {t('replays.comments.fieldLabel', { time })}
        </span>
        <Input
          autoFocus
          value={draft}
          maxLength={SIDECAR_LIMITS.comment}
          aria-invalid={errorKey !== null}
          className="h-7 min-w-0 flex-1 text-sm"
          data-testid="replays-timeline-comment-field"
          onChange={(event) => {
            setDraft(event.target.value)
            setErrorKey(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            } else if (event.key === 'Enter') {
              event.preventDefault()
              void save()
            }
          }}
        />
      </label>
      {errorKey !== null && (
        <span
          role="alert"
          className="max-w-72 truncate text-xs text-danger"
          title={t(errorKey)}
          data-testid="replays-timeline-comment-error"
        >
          {t(errorKey)}
        </span>
      )}
      <Button
        size="sm"
        variant="primary"
        onClick={() => void save()}
        data-testid="replays-timeline-comment-save"
      >
        {t('replays.comments.save')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClose}
        data-testid="replays-timeline-comment-cancel"
      >
        {t('common.action.cancel')}
      </Button>
    </div>
  )
}

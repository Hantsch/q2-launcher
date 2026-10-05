import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Undo2, X } from 'lucide-react'
import { suggestTags, validateTag } from '@shared/replays/sidecar-draft'
import type { DemoRow } from '@shared/modules/replays'
import { Button, IconButton } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { cn } from '../../../lib/cn'
import { TagInput } from './TagInput'

interface CarriedTag {
  tag: string
  count: number
}

const lower = (tag: string): string => tag.toLowerCase()

/** The tags on `rows`, case-insensitively merged and named by their first spelling. */
function carriedTags(rows: readonly DemoRow[]): CarriedTag[] {
  const merged = new Map<string, CarriedTag>()
  for (const row of rows) {
    const seen = new Set<string>()
    for (const tag of row.sidecar.values.tags ?? []) {
      const key = lower(tag)
      if (seen.has(key)) continue
      seen.add(key)
      const found = merged.get(key)
      if (found !== undefined) found.count += 1
      else merged.set(key, { tag, count: 1 })
    }
  }
  return [...merged.values()].sort((a, b) => a.tag.localeCompare(b.tag))
}

export interface TagDemosDialogProps {
  /** The demos the tags apply to, as listed now; zip entries are read-only and never counted. */
  rows: readonly DemoRow[]
  /** Every demo's tags, for the add input's suggestions. */
  allTags: string[][]
  onSubmit: (add: string[], remove: string[]) => void
  onClose: () => void
}

/** Adds tags to and removes tags from several demos at once; nothing is sent until Apply. */
export function TagDemosDialog({ rows, allTags, onSubmit, onClose }: TagDemosDialogProps) {
  const { t } = useTranslation()
  const writable = useMemo(() => rows.filter((row) => row.archiveEntry === null), [rows])
  const carried = useMemo(() => carriedTags(writable), [writable])
  const [add, setAdd] = useState<string[]>([])
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const [text, setText] = useState('')
  const changed = add.length > 0 || removed.size > 0

  const toggleRemoved = (tag: string, on: boolean): void => {
    setRemoved((prev) => {
      const next = new Set(prev)
      if (on) next.add(lower(tag))
      else next.delete(lower(tag))
      return next
    })
  }

  return (
    <Modal
      open
      size="md"
      title={t('replays.bulk.tag.title', { count: writable.length })}
      description={t('replays.bulk.tag.description')}
      onClose={onClose}
      closeLabel={t('common.action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-testid="replays-bulk-tag-cancel">
            {t('common.action.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!changed}
            onClick={() =>
              onSubmit(
                add,
                carried.filter((entry) => removed.has(lower(entry.tag))).map((entry) => entry.tag),
              )
            }
            data-testid="replays-bulk-tag-apply"
          >
            {t('replays.bulk.tag.apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs text-ink-muted">{t('replays.bulk.tag.carried')}</p>
          {carried.length === 0 ? (
            <p className="text-xs text-ink-faint" data-testid="replays-bulk-tag-none">
              {t('replays.bulk.tag.none')}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" data-testid="replays-bulk-tag-carried">
              {carried.map(({ tag, count }) => {
                const gone = removed.has(lower(tag))
                return (
                  <li
                    key={tag}
                    data-removed={gone}
                    className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink"
                    data-testid="replays-bulk-tag-chip"
                  >
                    <span className={cn(gone && 'text-ink-faint line-through')}>{tag}</span>
                    <span className="text-ink-muted">
                      {t('replays.bulk.tag.carriedBy', { count, total: writable.length })}
                    </span>
                    {gone ? (
                      <IconButton
                        label={t('replays.bulk.tag.keep', { tag })}
                        size="sm"
                        variant="ghost"
                        className="size-4 border-0"
                        onClick={() => toggleRemoved(tag, false)}
                      >
                        <Undo2 className="size-3" aria-hidden="true" />
                      </IconButton>
                    ) : (
                      <IconButton
                        label={t('replays.editor.tags.remove', { tag })}
                        size="sm"
                        variant="ghost"
                        className="size-4 border-0"
                        onClick={() => toggleRemoved(tag, true)}
                      >
                        <X className="size-3" aria-hidden="true" />
                      </IconButton>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-ink-muted">{t('replays.bulk.tag.addLabel')}</p>
          <TagInput
            tags={add}
            suggestions={suggestTags(allTags, text, add)}
            validate={validateTag}
            onInputChange={setText}
            onAddTag={(tag) => {
              toggleRemoved(tag, false)
              setAdd((prev) => (prev.some((p) => lower(p) === lower(tag)) ? prev : [...prev, tag]))
            }}
            onRemoveTag={(tag) => setAdd((prev) => prev.filter((p) => lower(p) !== lower(tag)))}
          />
        </div>
      </div>
    </Modal>
  )
}

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import type { DemoRow } from '@shared/modules/replays'
import type { DemoDetail } from '@shared/replays/demo-detail'
import {
  draftFromSidecar,
  draftToFields,
  setFields,
  type SidecarDraft,
} from '@shared/replays/sidecar-draft'
import { IconButton } from '../../../components/ui/Button'
import { useDemoEditorStore, type RowPatcher } from '../demo-editor-store'
import { DemoPlayersPanel } from './DemoPlayersPanel'
import { SidesEditor } from './SidesEditor'

export interface SidesFieldProps {
  row: DemoRow
  detail: DemoDetail
  readOnly: boolean
  onRowPatched: RowPatcher
}

function normalisedSides(draft: SidecarDraft): string {
  const converted = draftToFields(draft)
  return JSON.stringify(converted.ok ? (converted.fields.sides ?? null) : null)
}

/**
 * The detail's roster that edits in place: activating it swaps the team list for the sides editor on
 * a local draft; moving focus out of the field saves the normalised sides, Escape drops the draft.
 * (story 243)
 */
export function SidesField({ row, detail, readOnly, onRowPatched }: SidesFieldProps) {
  const { t } = useTranslation()
  const [draft, setDraftState] = useState<SidecarDraft | null>(null)
  const [refused, setRefused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ draft, row })
  latest.current = { draft, row }

  const setDraft = (next: SidecarDraft | null): void => {
    latest.current.draft = next
    setDraftState(next)
    setRefused(false)
  }

  const editing = draft !== null
  useEffect(() => {
    if (editing) containerRef.current?.focus()
  }, [editing])

  const open = (): void => {
    if (readOnly) return
    setDraft(draftFromSidecar(row.sidecar.values))
  }

  const commit = async (): Promise<void> => {
    const { draft: current, row: currentRow } = latest.current
    if (current === null) return
    const converted = draftToFields(current)
    if (!converted.ok) {
      setRefused(true)
      return
    }
    if (normalisedSides(current) === normalisedSides(draftFromSidecar(currentRow.sidecar.values))) {
      setDraft(null)
      return
    }
    const result = await useDemoEditorStore
      .getState()
      .edit(currentRow.id, setFields({ sides: converted.fields.sides }), onRowPatched)
    if (result === 'failed') setRefused(true)
    else if (latest.current.draft === current) setDraft(null)
  }

  if (draft !== null) {
    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        className="outline-none"
        data-testid="replays-detail-sides-editor"
        onBlur={(event: FocusEvent) => {
          const next = event.relatedTarget as Node | null
          if (next === null || !event.currentTarget.contains(next)) void commit()
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          setDraft(null)
        }}
      >
        <SidesEditor
          draft={draft}
          knownPlayers={detail.knownPlayers}
          disabled={false}
          onChange={setDraft}
        />
        {refused && (
          <p className="mt-1 text-xs text-danger" data-testid="replays-detail-sides-error">
            {t('replays.detail.sides.refused')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="group relative"
      data-testid="replays-detail-sides"
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('summary')) open()
      }}
    >
      <DemoPlayersPanel groups={detail.playerGroups} />
      {!readOnly && (
        <IconButton
          label={t('replays.detail.sides.edit')}
          size="sm"
          className="absolute top-0 right-0"
          onClick={(event) => {
            event.stopPropagation()
            open()
          }}
          data-testid="replays-detail-sides-edit"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { addPlayer, addSide, movePlayer, removePlayer, removeSide, type SidecarDraft } from '@shared/replays/sidecar-draft'
import { Button, IconButton } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'

export interface SidesEditorProps {
  draft: SidecarDraft
  knownPlayers: { demo: string[]; name: string[] }
  disabled: boolean
  onChange: (draft: SidecarDraft) => void
}

const MAX_SIDES = 16
const MAX_PLAYERS = 64

/**
 * Story 155: the sides/teams/players editor mounted inside `DemoNotesEditor.tsx`. Every mutation
 * goes through `sidecar-draft.ts`'s pure ops (never a direct object mutation) - this component only
 * reads `draft.sides` and calls `onChange` with the op's result.
 */
export function SidesEditor({ draft, knownPlayers, disabled, onChange }: SidesEditorProps) {
  const { t } = useTranslation()
  const [playerInputs, setPlayerInputs] = useState<Record<number, string>>({})

  const knownChips: Array<{ name: string; labelKey: string }> = [
    ...knownPlayers.demo.map((name) => ({ name, labelKey: 'replays.editor.sides.knownPlayer.fromDemo' })),
    ...knownPlayers.name.map((name) => ({ name, labelKey: 'replays.editor.sides.knownPlayer.fromFileName' })),
  ]

  const setSideField = (sideIndex: number, patch: Partial<{ team: string; result: string }>): void => {
    onChange({
      ...draft,
      sides: draft.sides.map((s, i) => (i === sideIndex ? { ...s, ...patch } : s)),
    })
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {t('replays.editor.sides.section')}
      </h4>

      <div className="space-y-3">
        {draft.sides.map((side, sideIndex) => {
          const inputValue = playerInputs[sideIndex] ?? ''
          return (
            <div
              key={sideIndex}
              className="space-y-2 rounded-sm border border-line-strong p-2.5"
              data-testid={`replays-side-${sideIndex}`}
            >
              <div className="flex items-end gap-2">
                <Field label={t('replays.editor.sides.team')} className="flex-1">
                  <Input
                    value={side.team}
                    maxLength={64}
                    disabled={disabled}
                    onChange={(event) => setSideField(sideIndex, { team: event.target.value })}
                    data-testid={`replays-side-${sideIndex}-team`}
                  />
                </Field>
                <Field label={t('replays.editor.sides.result')} className="flex-1">
                  <Input
                    value={side.result}
                    maxLength={32}
                    disabled={disabled}
                    onChange={(event) => setSideField(sideIndex, { result: event.target.value })}
                    data-testid={`replays-side-${sideIndex}-result`}
                  />
                </Field>
                <IconButton
                  label={t('replays.editor.sides.removeSide')}
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange(removeSide(draft, sideIndex))}
                  data-testid={`replays-side-${sideIndex}-remove`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </IconButton>
              </div>

              {side.players.length > 0 && (
                <ol className="space-y-1">
                  {side.players.map((player, playerIndex) => (
                    <li
                      key={playerIndex}
                      className="flex items-center gap-2 text-sm"
                      data-testid={`replays-side-${sideIndex}-player-${playerIndex}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-ink">{player}</span>
                      <IconButton
                        label={t('replays.editor.sides.movePlayerUp', { name: player })}
                        size="sm"
                        disabled={disabled || playerIndex === 0}
                        onClick={() => onChange(movePlayer(draft, sideIndex, playerIndex, -1))}
                      >
                        <ChevronUp className="size-3.5" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={t('replays.editor.sides.movePlayerDown', { name: player })}
                        size="sm"
                        disabled={disabled || playerIndex === side.players.length - 1}
                        onClick={() => onChange(movePlayer(draft, sideIndex, playerIndex, 1))}
                      >
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        label={t('replays.editor.sides.removePlayer', { name: player })}
                        size="sm"
                        disabled={disabled}
                        onClick={() => onChange(removePlayer(draft, sideIndex, playerIndex))}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </IconButton>
                    </li>
                  ))}
                </ol>
              )}

              <Input
                value={inputValue}
                maxLength={64}
                placeholder={t('replays.editor.sides.addPlayerPlaceholder')}
                disabled={disabled || side.players.length >= MAX_PLAYERS}
                onChange={(event) => setPlayerInputs((prev) => ({ ...prev, [sideIndex]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  const name = inputValue.trim()
                  if (name === '') return
                  onChange(addPlayer(draft, sideIndex, name))
                  setPlayerInputs((prev) => ({ ...prev, [sideIndex]: '' }))
                }}
                data-testid={`replays-side-${sideIndex}-add-player`}
              />

              {knownChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {knownChips.map((chip, chipIndex) => {
                    const present = side.players.some((p) => p.toLowerCase() === chip.name.toLowerCase())
                    return (
                      <button
                        key={`${chip.name}-${chipIndex}`}
                        type="button"
                        disabled={disabled || present}
                        data-testid="replays-known-player"
                        className="rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink-dim transition-colors duration-[--dur-fast] hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-45"
                        onClick={() => onChange(addPlayer(draft, sideIndex, chip.name))}
                      >
                        {chip.name} ({t(chip.labelKey)})
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Button
        type="button"
        variant="neutral"
        size="sm"
        icon={<Plus className="size-3.5" aria-hidden="true" />}
        disabled={disabled || draft.sides.length >= MAX_SIDES}
        onClick={() => onChange(addSide(draft))}
        data-testid="replays-sides-add"
      >
        {t('replays.editor.sides.addSide')}
      </Button>
    </div>
  )
}

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BindCollision } from '@shared/config/bind-collision'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/primitives'
import type { SlotCollision } from '../lib/bind-slot-collision'
import { useKeyCapture } from '../lib/useKeyCapture'

/**
 * Story 015 D4: a reusable Primary/Secondary bind slot for the catalogue-row
 * panels D5/D6 build next (`DualBindPanel`, `DropBindPanel`), each rendering
 * roughly 15-40 rows x 2 slots.
 *
 * Ownership choice (documented here for whoever builds D5/D6 next, per the
 * D4 deliverable note): `BindSlot` owns its own capture lifecycle via
 * `useKeyCapture` internally rather than taking `capturing`/`onStartCapture`
 * from its parent. The parent only controls `boundKey` and reacts to
 * `onAssign`/`onClear`. This is the simpler integration for a panel with many
 * rows - it does not need to track per-slot capture state itself - and it
 * leaves room for D7: `onAssign` hands the captured key to the parent, which
 * from D7 onward may hold it behind a collision banner (Cancel/Replace)
 * instead of committing it straight into `boundKey`.
 *
 * Story 015 D7: that room is now used. A capture no longer goes straight to
 * `onAssign` - it is first passed through the row's `checkCollision`, and the
 * two-tier outcome of that check is this component's own state:
 *
 * - nothing owns the key -> `onAssign`, exactly as in D4.
 * - only an alt layer owns it (decision 14) -> `onAssign` anyway, plus a
 *   non-blocking warning; a base bind and a layer override legitimately
 *   coexist (cf. `layer.triggerConflict`).
 * - a base bind or another action owns it (decision 13) -> nothing is applied.
 *   The captured key is parked in `pending` and the slot renders an inline
 *   Cancel/Replace banner instead, mirroring `AdvancedTab`'s category-delete
 *   confirm. Cancel fires no callback at all, so the slot is left exactly as
 *   it was; Replace hands the key *and* the collision back to the row, which
 *   is the only place that can release the previous owner in the same save
 *   (`applyReplace`).
 */

/** The two collision kinds that block an assignment (decision 13). */
type BlockingCollision = Exclude<BindCollision, { kind: 'layerOverride' }>

interface PendingCapture {
  key: string
  collision: BlockingCollision
  owner: string
}

const BLOCKING_MESSAGE_KEY: Record<BlockingCollision['kind'], string> = {
  baseBind: 'config.advanced.collision.baseBind',
  action: 'config.advanced.collision.action',
}

export function BindSlot({
  label,
  boundKey,
  onAssign,
  onReplace,
  onClear,
  checkCollision,
}: {
  /** Accessible name for this slot, e.g. "Primary" / "Secondary". */
  label: string
  boundKey: string | undefined
  /** Applies the captured key. Called only when nothing blocks it. */
  onAssign: (key: string) => void
  /**
   * Applies the captured key *and* releases it from `collision`'s owner in a
   * single save - see `applyReplace`. Called only from the Replace button.
   */
  onReplace: (key: string, collision: BindCollision) => void
  onClear: () => void
  /** Who, if anyone, already owns a key - the row's `findSlotCollision` closure. */
  checkCollision: (key: string) => SlotCollision | null
}) {
  const { t } = useTranslation()
  const [capturing, setCapturing] = useState(false)
  const [pending, setPending] = useState<PendingCapture | null>(null)
  const [layerWarning, setLayerWarning] = useState<{ key: string; owner: string } | null>(null)

  const handleCapture = useCallback(
    ({ key }: { key: string }) => {
      setCapturing(false)
      const found = checkCollision(key)

      if (found) {
        const { collision, owner } = found
        if (collision.kind !== 'layerOverride') {
          // Decision 13: not applied - the row keeps whatever it had until the
          // user picks Cancel or Replace below.
          setLayerWarning(null)
          setPending({ key, collision, owner })
          return
        }
        // Decision 14: applied, warned about. Layer overrides are written
        // through a different IPC channel entirely, so there is nothing to
        // release and nothing to confirm.
        setLayerWarning({ key, owner })
        onAssign(key)
        return
      }

      setLayerWarning(null)
      onAssign(key)
    },
    [checkCollision, onAssign],
  )
  const handleCancel = useCallback(() => setCapturing(false), [])

  useKeyCapture(capturing, handleCapture, handleCancel)

  const startCapture = (): void => {
    setLayerWarning(null)
    setCapturing(true)
  }

  const clearKey = (): void => {
    setLayerWarning(null)
    onClear()
  }

  // `flex-wrap` (D7): the banner and the warning below are far wider than a
  // key badge, and the slot column they live in is a fixed `min-w-*` one in
  // both host panels - wrapping inside the column beats overflowing out of it.
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {pending ? (
        <>
          <span
            role="alert"
            className="rounded-sm border border-danger/35 bg-danger/8 px-2.5 py-1.5 text-xs text-danger"
          >
            {t(BLOCKING_MESSAGE_KEY[pending.collision.kind], {
              key: pending.key,
              owner: pending.owner,
            })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              const { key, collision } = pending
              setPending(null)
              onReplace(key, collision)
            }}
          >
            {t('config.advanced.collision.replace')}
          </Button>
        </>
      ) : capturing ? (
        <Badge tone="warning">{t('config.advanced.editor.capturing')}</Badge>
      ) : (
        <>
          {boundKey ? (
            <Badge tone="flame" className="numeric">
              {boundKey}
            </Badge>
          ) : (
            <span className="text-xs text-ink-muted">{t('config.advanced.editor.keyNotSet')}</span>
          )}
          {/* AC 3 (review finding): pressing a new key must replace whatever was there directly -
              an occupied slot still offers "capture" alongside Clear, mirroring `ActionEditor`'s
              idiom (always-visible capture button), rather than forcing Clear first. */}
          <Button variant="ghost" size="sm" onClick={startCapture}>
            {t('config.advanced.editor.captureKey')}
          </Button>
          {boundKey && (
            <Button variant="danger" size="sm" onClick={clearKey}>
              {t('config.advanced.editor.clearKey')}
            </Button>
          )}
        </>
      )}

      {!pending && layerWarning && (
        <span
          role="status"
          className="rounded-sm border border-warning/35 bg-warning/8 px-2.5 py-1.5 text-xs text-warning"
        >
          {t('config.advanced.collision.layerOverride', {
            key: layerWarning.key,
            owner: layerWarning.owner,
          })}
        </span>
      )}
    </div>
  )
}

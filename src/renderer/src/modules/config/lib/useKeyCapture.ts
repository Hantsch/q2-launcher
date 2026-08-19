import { useEffect } from 'react'
import { resolveQuakeKeyName } from './keyboard-layout'

export interface KeyCaptureResult {
  key: string
  modifiers: { alt: boolean; ctrl: boolean; shift: boolean }
}

/**
 * Story 015 D4: the reusable keydown-capture primitive extracted from
 * `ActionEditor`'s inline capture effect (decision 12) - listener shape and
 * ordering mirror it exactly (resolve first, `preventDefault` +
 * `stopPropagation` on every handled keydown, *then* check `event.repeat`,
 * same reasoning as `ActionEditor`'s comment: without stopping propagation a
 * capture hosted inside a `Modal` would also bubble to the modal's own
 * document-level Escape handler). `modifiers` is reported alongside `key`
 * even though this story's only consumer (`BindSlot`) ignores it - that is
 * exactly the plug point story 016 needs later, without changing this hook's
 * behaviour then.
 *
 * Deliberate difference from `ActionEditor`: here `Escape` cancels the
 * capture instead of being reported as a bindable key, even though
 * `resolveQuakeKeyName` resolves it to `'ESCAPE'` and `ActionEditor` DOES let
 * you bind Escape. That is this hook's own contract for D4's use case (its
 * own acceptance text says "cancels on Escape"), not a claim that
 * `ActionEditor`'s behaviour is wrong - `ActionEditor` is not built on this
 * hook and keeps its own inline effect (decision 12: the four existing
 * inline capture sites are not refactored).
 *
 * The four existing inline capture effects (`ActionEditor`, `MessageEditor`,
 * `OverviewKeyboardPanel`, `SwitchBindControl`) stay exactly as they are -
 * this hook is new, additive plumbing for `BindSlot` only.
 */
export function useKeyCapture(
  active: boolean,
  onCapture: (result: KeyCaptureResult) => void,
  onCancel?: () => void,
): void {
  useEffect(() => {
    if (!active) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      const quakeKey = resolveQuakeKeyName(event)
      if (!quakeKey) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return

      if (quakeKey === 'ESCAPE') {
        onCancel?.()
        return
      }

      onCapture({
        key: quakeKey,
        modifiers: { alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey },
      })
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [active, onCapture, onCancel])
}

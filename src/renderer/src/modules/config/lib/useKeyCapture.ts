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
 *
 * Review-fix (post-D3): `onKeyUp` is optional plumbing added for
 * `resolveModifierRelease` (`modifier-capture.ts`) - `BindSlot` needs to know
 * when a *held* key is released, not just when one goes down, to tell "the
 * user is mid-gesture, holding a modifier before the real key" apart from
 * "the user pressed and released a bare modifier as its own bind". This hook
 * still does no classification itself - it only resolves the released key
 * through the same `resolveQuakeKeyName` and reports it, exactly like
 * `onCapture` does for keydown. No `preventDefault`/`repeat` handling here:
 * a keyup has no OS auto-repeat and this hook does not intercept the
 * browser's default keyup behaviour, only listens for it.
 */
export function useKeyCapture(
  active: boolean,
  onCapture: (result: KeyCaptureResult) => void,
  onCancel?: () => void,
  onKeyUp?: (result: KeyCaptureResult) => void,
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

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!onKeyUp) return
      const quakeKey = resolveQuakeKeyName(event)
      if (!quakeKey) return

      onKeyUp({
        key: quakeKey,
        modifiers: { alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey },
      })
    }

    window.addEventListener('keydown', handleKeyDown, true)
    if (onKeyUp) window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      if (onKeyUp) window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [active, onCapture, onCancel, onKeyUp])
}

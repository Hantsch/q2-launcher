import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConfigProfile } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { useLauncher } from '../../../store/useLauncher'
import { toastOutcomeError } from '../../../lib/toast'

/** How long typed edits to a profile are coalesced before one save goes out. */
export const SAVE_DEBOUNCE_MS = 500

export type SaveStatus = 'idle' | 'saving' | 'saved'

export interface ScheduledSave<T> {
  /** The optimistic draft patch - applied synchronously, before the save is even queued. */
  apply: () => void
  /** Restores the state from before this edit; only the first call of a burst keeps its revert. */
  revert: () => void
  /** Sends the full current value; only the last call of a burst runs. */
  run: () => Promise<Outcome<T>>
}

export interface ImmediateSave<T> {
  run: () => Promise<Outcome<T>>
}

export interface UseProfileSaveOptions<T> {
  profileId: string
  onChanged: (value: T) => void
}

export interface UseProfileSaveResult<T> {
  status: SaveStatus
  /** True while an immediate save is in flight - debounced saves never set it. */
  saving: boolean
  schedule: (save: ScheduledSave<T>) => void
  /**
   * Saves right away, dropping any pending debounced save first - `run` must therefore carry
   * whatever that pending save would have sent. Resolves `false` on a refusal and also when the
   * result was ignored (profile switched or unmounted), so the caller only applies on `true`.
   */
  saveNow: (save: ImmediateSave<T>) => Promise<boolean>
  /** Drops a pending debounced save without running or reverting it. */
  cancel: () => void
}

interface PendingBurst<T> {
  revert: () => void
  run: () => Promise<Outcome<T>>
}

/**
 * The one save path for profile edits: debounced optimistic edits and immediate structural saves
 * share a single timer, so an immediate save can never be overwritten by a stale debounced one.
 */
export function useProfileSave<T = ConfigProfile[]>({
  profileId,
  onChanged,
}: UseProfileSaveOptions<T>): UseProfileSaveResult<T> {
  const pushToast = useLauncher((s) => s.pushToast)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saving, setSaving] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const burstRef = useRef<PendingBurst<T> | null>(null)
  /** Bumped on profile switch and unmount; a result from an older epoch is dropped entirely. */
  const epochRef = useRef(0)
  /**
   * Bumped by every edit and every immediate save. A result whose save is no longer the latest must
   * not revert or set the status: the newer save carries the full value and owns both.
   */
  const seqRef = useRef(0)
  const immediateInFlightRef = useRef(0)
  const onChangedRef = useRef(onChanged)

  useEffect(() => {
    onChangedRef.current = onChanged
  }, [onChanged])

  const clearPending = useCallback((): boolean => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const hadBurst = burstRef.current !== null
    burstRef.current = null
    return hadBurst
  }, [])

  useEffect(() => {
    setStatus('idle')
    setSaving(false)
    return () => {
      epochRef.current += 1
      immediateInFlightRef.current = 0
      clearPending()
    }
  }, [profileId, clearPending])

  const execute = useCallback(
    async (run: () => Promise<Outcome<T>>, revert: (() => void) | null): Promise<boolean> => {
      const epoch = epochRef.current
      const seq = seqRef.current
      const result = await run()
      if (epoch !== epochRef.current) return false
      const latest = seq === seqRef.current
      if (result.ok) {
        onChangedRef.current(result.value)
        if (latest) setStatus('saved')
      } else {
        toastOutcomeError(pushToast, result)
        if (latest) {
          revert?.()
          setStatus('idle')
        }
      }
      return result.ok
    },
    [pushToast],
  )

  const schedule = useCallback(
    (save: ScheduledSave<T>): void => {
      save.apply()
      seqRef.current += 1
      // The revert of the burst's first edit holds the pre-burst snapshot; a later closure would
      // restore a state that already contains earlier edits of the same burst.
      burstRef.current = { revert: burstRef.current?.revert ?? save.revert, run: save.run }
      setStatus('saving')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const burst = burstRef.current
        burstRef.current = null
        if (burst) void execute(burst.run, burst.revert)
      }, SAVE_DEBOUNCE_MS)
    },
    [execute],
  )

  const saveNow = useCallback(
    async (save: ImmediateSave<T>): Promise<boolean> => {
      clearPending()
      seqRef.current += 1
      const epoch = epochRef.current
      immediateInFlightRef.current += 1
      setSaving(true)
      setStatus('saving')
      const ok = await execute(save.run, null)
      if (epoch !== epochRef.current) return false
      immediateInFlightRef.current -= 1
      if (immediateInFlightRef.current === 0) setSaving(false)
      return ok
    },
    [execute, clearPending],
  )

  const cancel = useCallback((): void => {
    if (clearPending()) setStatus('idle')
  }, [clearPending])

  return { status, saving, schedule, saveNow, cancel }
}

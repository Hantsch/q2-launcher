import type { UpdateDownloadProgress, UpdateState } from '@shared/types'
import { resolveUpdatePhase, type UpdateServiceOptions } from './service'

/** How far the *download* has got - the half of the phase that the check status knows nothing
 * about. Kept separate from `UpdateState.status` so the two can never contradict each other. */
export type DownloadStage = 'none' | 'downloading' | 'downloaded'

/**
 * The part of `UpdateState` that a *check* owns. The other three fields (`phase`, `progress`,
 * `dismissed`) are owned by {@link UpdateStateCell} and written in exactly one place, so no caller
 * can hand in a `phase` that disagrees with the facts it came with.
 */
export type UpdateFacts = Pick<
  UpdateState,
  'status' | 'update' | 'error' | 'lastCheckedAt' | 'lastSuccessAt' | 'supported'
>

/** Nothing known, nothing attempted. */
function idleFacts(supported: boolean): UpdateFacts {
  return {
    status: 'idle',
    update: null,
    error: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    supported,
  }
}

/**
 * The update service's one piece of shared mutable state. The check, download and simulate parts
 * all write through this cell, and every write is published through {@link publish} - so there is
 * exactly one `UpdateState` and exactly one place it is assembled.
 */
export class UpdateStateCell {
  readonly supported: boolean
  facts: UpdateFacts
  /** Story 098: the download half of the state. Written only by `startDownload`/`runDownload` and
   * by a check that learns of a *different* release. */
  stage: DownloadStage = 'none'
  progress: UpdateDownloadProgress | null = null
  dismissed = false
  /** Guards a superseded download: a late progress callback or resolution from a download the user
   * already cancelled must not write over the state a newer one produced. */
  downloadGeneration = 0
  cancelRequested = false
  state: UpdateState
  private readonly options: Pick<UpdateServiceOptions, 'onStateChange' | 'log'>

  constructor(options: Pick<UpdateServiceOptions, 'isPackaged' | 'onStateChange' | 'log'>) {
    this.options = options
    this.supported = options.isPackaged
    this.facts = idleFacts(this.supported)
    this.state = this.compose()
  }

  /** The full state, assembled from the facts plus the three fields this cell owns. The only
   * place `phase`/`progress`/`dismissed` are produced. */
  compose(): UpdateState {
    return {
      ...this.facts,
      phase: resolveUpdatePhase(this.facts.status, this.facts.update !== null, this.stage),
      // Progress belongs to a running download and to nothing else - a stale readout on a finished
      // or failed one would be a lie the UI has no way to detect.
      progress: this.stage === 'downloading' ? this.progress : null,
      dismissed: this.dismissed,
    }
  }

  /** Publishes whatever `compose()` now says, if it differs from what was last published. Every
   * state change of the update service goes through here, whichever half of the state changed. */
  publish(): void {
    const next = this.compose()
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    try {
      this.options.onStateChange(this.state)
    } catch (error) {
      this.options.log?.warn(`update: the state callback threw (${describeError(error)})`)
    }
  }

  emit(next: UpdateFacts): void {
    this.facts = next
    this.publish()
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

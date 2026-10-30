import type { EngineDataEntry } from '../lib/renderer-source'

export type EngineDataResolver = (token: string, index: number) => Promise<EngineDataEntry | null>

export interface EngineDataPort {
  /** The integrated session registers itself here; the last provider wins. */
  provide: (resolve: EngineDataResolver) => void
  resolve: EngineDataResolver
}

/**
 * The seam between the protocol handler (registered before the context exists) and the module that
 * owns the session: nothing provided yet means nothing to serve. (story 289)
 */
export function createEngineDataPort(): EngineDataPort {
  let provider: EngineDataResolver | null = null
  return {
    provide: (resolve) => {
      provider = resolve
    },
    resolve: (token, index) => (provider ? provider(token, index) : Promise.resolve(null)),
  }
}

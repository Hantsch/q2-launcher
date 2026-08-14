import { LIBRARY_HANDLERS, type LibraryStats } from '@shared/modules/library'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the library module. One function per handler in its contract. */
export function getLibraryStats(): Promise<Outcome<LibraryStats>> {
  return callModule<LibraryStats>('library', LIBRARY_HANDLERS.stats)
}

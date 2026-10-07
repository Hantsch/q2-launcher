import { LIBRARY_HANDLERS, type LibraryContract, type LibraryStats } from '@shared/modules/library'
import type { Outcome } from '@shared/types'
import { createModuleClient } from '../moduleClient'

const client = createModuleClient<LibraryContract>('library')

/** Typed client for the library module. One function per handler in its contract. */
export function getLibraryStats(): Promise<Outcome<LibraryStats>> {
  return client.call(LIBRARY_HANDLERS.stats)
}

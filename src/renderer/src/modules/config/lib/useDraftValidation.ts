import { useMemo } from 'react'
import { useProfileDraftContext } from './ProfileDraftProvider'
import { validateProfileForEngines } from './validation-scope'

/**
 * Validates the *draft* the user is looking at, not the last saved profile, so a Care finding
 * appears the instant an edit happens. Reads the draft context, so callers must sit below
 * `ProfileDraftProvider`. (story 218)
 */
export function useDraftValidation(): ReturnType<typeof validateProfileForEngines> {
  const { draft, installations } = useProfileDraftContext()
  return useMemo(() => validateProfileForEngines(draft, installations), [draft, installations])
}

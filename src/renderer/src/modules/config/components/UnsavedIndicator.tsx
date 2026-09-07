import { useTranslation } from 'react-i18next'
import { PencilLine } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { Badge } from '../../../components/ui/primitives'
import { useUnsavedState } from '../lib/unsaved-state'

/**
 * "Unsaved changes", right next to the profile name - the status half of the old `ProfileSaveBar`
 * row (story 043 D6), moved to the name it is actually about. Icon + text, never colour alone, the
 * same idiom the bar used.
 *
 * Nothing is rendered while the profile is saved: the bar's counterpart green "Saved" badge is gone
 * with it. A profile whose file matches its edits is the normal state, and a permanent "Saved" badge
 * next to every profile name says nothing the absence of a warning does not already say.
 *
 * Covers both sources of "unsaved" (structured edits and a raw text draft) with one wording, because
 * next to the profile name that is the whole message; which of the two it is, and what exactly is
 * pending, is what the Unsaved tab (`UnsavedChangesTab`) says.
 */
export function UnsavedIndicator({ profile }: { profile: Pick<ConfigProfile, 'dirty'> }) {
  const { t } = useTranslation()
  const { unsaved } = useUnsavedState(profile)

  if (!unsaved) return null

  return (
    <span data-testid="config-unsaved-indicator" className="inline-flex">
      <Badge tone="warning" className="gap-1">
        <PencilLine className="size-3" />
        {t('config.save.unsaved')}
      </Badge>
    </span>
  )
}

/**
 * The Unsaved tab's own count badge, the same mechanism the Care tab's finding count uses - except
 * the count comes from a React context (`useUnsavedState`) that `ConfigView` cannot read from its
 * own body, since it is the component that mounts the providers. So the tab strip gets a node to
 * render rather than a string (`badgeNode` in `ConfigView`'s `tabs`), and the count is computed here,
 * below the providers, from the exact same change set the tab's own list renders.
 */
export function UnsavedTabBadge({ profile }: { profile: Pick<ConfigProfile, 'dirty'> }) {
  const { badgeCount } = useUnsavedState(profile)

  if (badgeCount === 0) return null

  return <Badge tone="warning">{badgeCount}</Badge>
}

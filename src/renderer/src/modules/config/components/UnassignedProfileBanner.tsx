import { useTranslation } from 'react-i18next'
import { Link2 } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { ProfileBanner } from './ProfileBanner'

/**
 * Tells the user that a profile no installation loads, with the one action that fixes it. Derived
 * from `profile.assignments` alone, so assigning from any surface removes it without a reload. (story 253)
 */
export function UnassignedProfileBanner({
  profile,
  onAssign,
}: {
  profile: ConfigProfile
  onAssign: () => void
}) {
  const { t } = useTranslation()
  if (profile.assignments.length > 0) return null

  return (
    <ProfileBanner
      tone="warning"
      title={t('config.assignment.unassignedBanner.title')}
      body={t('config.assignment.unassignedBanner.body')}
      testId="config-unassigned-banner"
    >
      <Button
        variant="neutral"
        size="sm"
        icon={<Link2 className="size-3.5" />}
        data-testid="config-unassigned-assign"
        onClick={onAssign}
      >
        {t('config.assignment.unassignedBanner.assign')}
      </Button>
    </ProfileBanner>
  )
}

import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'
import type { ServerListRow } from '@shared/modules/servers'
import { Button, PlayButton } from '../../../components/ui/Button'
import { useActiveInstallation } from '../../../store/useLauncher'
import { useJoinFlow } from './useJoinFlow'

/**
 * Story 125 D4: a single button over `useJoinFlow` (address check, mod-mismatch warning, password
 * prompt, then `play()` with `+connect`/`userinfo`).
 *
 * `prominent` renders the button as the action bar's `PlayButton` (same look, label "Join") for
 * the one place it is the primary action - the server detail pane. Everywhere else (the watchlist's
 * dense match rows) it stays a neutral button. The flow is identical either way.
 *
 * No active installation: the button stays visible and disabled (CLAUDE.md's "never silently
 * omitted" rule), with `servers.join.noInstallation` rendered as real text next to it, mirroring
 * how other disabled-with-reason controls in this module (e.g. `ServersView`'s blocked-scan text)
 * surface their reason inline rather than only in a tooltip.
 */
export function JoinServerButton({
  row,
  prominent = false,
}: {
  row: ServerListRow
  prominent?: boolean
}) {
  const { t } = useTranslation()
  const installation = useActiveInstallation()
  const { start, addressError, dialogs } = useJoinFlow()
  const handleClick = (): void => start(row)

  return (
    <div className="flex items-center gap-2">
      {prominent ? (
        <PlayButton
          onClick={handleClick}
          disabled={!installation}
          data-testid="servers-join"
          icon={<Play className="size-4" fill="currentColor" />}
        >
          {t('servers.join.action')}
        </PlayButton>
      ) : (
        <Button
          variant="neutral"
          onClick={handleClick}
          disabled={!installation}
          data-testid="servers-join"
        >
          {t('servers.join.action')}
        </Button>
      )}
      {!installation && (
        <span className="text-xs text-ink-muted" data-testid="servers-join-no-installation">
          {t('servers.join.noInstallation')}
        </span>
      )}
      {addressError && (
        <span className="text-xs text-danger" data-testid="servers-join-refused">
          {addressError}
        </span>
      )}
      {dialogs}
    </div>
  )
}

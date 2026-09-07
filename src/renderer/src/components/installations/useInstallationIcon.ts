import { useEffect } from 'react'
import type { Installation } from '@shared/types'
import { shippedIconUrl } from '../../lib/installation-icons'
import { useLauncher } from '../../store/useLauncher'

/**
 * Resolves the URL {@link InstallationTile} should show for an installation's
 * icon, story 067 D5.
 *
 * - `icon.kind === 'shipped'`: synchronous, no IPC - `shippedIconUrl` just
 *   looks the id up in the bundled manifest.
 * - `icon.kind === 'custom'`: fetched once via `installations:iconDataUrl`
 *   and cached in the launcher store (`iconDataUrls`, keyed by installation
 *   id), so remounts/rerenders - and the rail/card/action-bar all showing the
 *   same installation at once - never issue more than one request per
 *   installation.
 * - no `icon` at all: `null`, without touching the store or IPC (AC9 - "no
 *   extra request" when nothing is set).
 */
export function useInstallationIcon(installation: Installation | null): string | null {
  const installationId = installation?.id
  const icon = installation?.icon
  const isCustom = icon?.kind === 'custom'

  const cached = useLauncher((state) =>
    installationId !== undefined ? state.iconDataUrls[installationId] : undefined,
  )
  const fetchIconDataUrl = useLauncher((state) => state.fetchIconDataUrl)

  useEffect(() => {
    if (!isCustom || installationId === undefined) return
    // Already cached (or a fetch for it is already in flight, per the store's
    // own guard) - skip the call rather than relying solely on the store to
    // dedupe.
    if (cached !== undefined) return
    void fetchIconDataUrl(installationId)
  }, [isCustom, installationId, cached, fetchIconDataUrl])

  if (!icon) return null
  if (icon.kind === 'shipped') return shippedIconUrl(icon.id) ?? null
  return cached ?? null
}

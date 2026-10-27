import type { TFunction } from 'i18next'
import { countryName, type ServerLocation } from '@shared/servers/location'

/** `EU · Germany` for the list cell; `LAN` / `Unknown` for the two non-country kinds. A missing
 * location is a row the scan has not resolved yet and reads as Unknown. */
export function shortLocation(
  location: ServerLocation | undefined,
  t: TFunction,
  locale: string,
): string {
  if (location?.kind === 'country') {
    return `${location.continent} · ${countryName(location.country, locale)}`
  }
  return location?.kind === 'lan' ? t('servers.location.lan') : t('common.label.unknown')
}

/** `Germany, Europe` for the tooltip and the detail pane. */
export function fullLocation(
  location: ServerLocation | undefined,
  t: TFunction,
  locale: string,
): string {
  if (location?.kind === 'country') {
    return `${countryName(location.country, locale)}, ${t(`servers.location.region.${location.continent}`)}`
  }
  return location?.kind === 'lan' ? t('servers.location.lan') : t('common.label.unknown')
}

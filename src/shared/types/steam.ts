/**
 * Steam appid -> client table.
 *
 * Some Steam apps bundle several launchable clients under one appid, selected by
 * `steam://launch/<appid>/client/<index>`. Quake II's appid 2320 is the seed
 * entry: the 2023 remaster, the original release, and the two mission packs
 * each launch through their own index. Story 104 D1.
 */
export interface SteamAppClient {
  /** The `client/<index>` segment of the launch URL. */
  index: number
  /** i18n key for the client's label - never prose, see CLAUDE.md. */
  labelKey: string
}

export interface SteamAppClientTable {
  clients: readonly SteamAppClient[]
  /** Index launched when the user has not chosen a client explicitly. */
  defaultIndex: number
}

/**
 * Steam appid -> its known launchable clients. Only appids listed here are
 * eligible for `steamLaunchUrl()`; anything else is a plain Steam install with
 * no client choice to make.
 */
export const STEAM_APP_CLIENTS: Readonly<Record<string, SteamAppClientTable>> = {
  '2320': {
    clients: [
      { index: 1, labelKey: 'steam.client.enhanced' },
      { index: 2, labelKey: 'steam.client.original' },
      { index: 3, labelKey: 'steam.client.reckoning' },
      { index: 4, labelKey: 'steam.client.groundZero' },
    ],
    defaultIndex: 2,
  },
}

/**
 * Builds a `steam://launch/<appid>/client/<index>` URL. Returns `undefined`
 * when `appid` is not in `STEAM_APP_CLIENTS` or `index` is not one of that
 * appid's listed client indices, mirroring `getEngineDefinition`'s
 * lookup-or-undefined shape (`src/shared/types/engine.ts`) rather than
 * throwing.
 */
export function steamLaunchUrl(appid: string, index: number): string | undefined {
  const table = STEAM_APP_CLIENTS[appid]
  if (!table) return undefined
  if (!table.clients.some((client) => client.index === index)) return undefined
  return `steam://launch/${appid}/client/${index}`
}

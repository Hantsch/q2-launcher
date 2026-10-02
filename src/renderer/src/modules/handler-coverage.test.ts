import { describe, expect, it } from 'vitest'
import { CONFIG_HANDLERS } from '@shared/modules/config'
import { DOWNLOADS_HANDLERS } from '@shared/modules/downloads'
import { HOME_HANDLERS } from '@shared/modules/home'
import { LIBRARY_HANDLERS } from '@shared/modules/library'
import { MODS_HANDLERS } from '@shared/modules/mods'
import { REPLAYS_HANDLERS } from '@shared/modules/replays'
import { SERVERS_HANDLERS, SERVERS_WATCHLIST_HANDLERS } from '@shared/modules/servers'

const clients = import.meta.glob('./*/client.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const sourceOf = (module: string): string | undefined => clients[`./${module}/client.ts`]

interface Group {
  module: string
  name: string
  handlers: Record<string, string>
}

const GROUPS: Group[] = [
  { module: 'config', name: 'CONFIG_HANDLERS', handlers: CONFIG_HANDLERS },
  { module: 'downloads', name: 'DOWNLOADS_HANDLERS', handlers: DOWNLOADS_HANDLERS },
  { module: 'mods', name: 'MODS_HANDLERS', handlers: MODS_HANDLERS },
  { module: 'replays', name: 'REPLAYS_HANDLERS', handlers: REPLAYS_HANDLERS },
  { module: 'library', name: 'LIBRARY_HANDLERS', handlers: LIBRARY_HANDLERS },
  { module: 'home', name: 'HOME_HANDLERS', handlers: HOME_HANDLERS },
  { module: 'servers', name: 'SERVERS_HANDLERS', handlers: SERVERS_HANDLERS },
  { module: 'servers', name: 'SERVERS_WATCHLIST_HANDLERS', handlers: SERVERS_WATCHLIST_HANDLERS },
]

// Handlers with no renderer client call; read by `scripts/flows/servers-join.mjs`.
const FLOW_ONLY: Record<string, string[]> = { servers: ['historyRead'] }

const CONVERTED = ['home', 'servers']

describe('renderer module clients', () => {
  it("every handler constant is referenced by its module's client", () => {
    const missing: string[] = []
    for (const { module, name, handlers } of GROUPS) {
      const source = sourceOf(module)
      if (source === undefined) {
        missing.push(`${module}: no client.ts`)
        continue
      }
      for (const key of Object.keys(handlers)) {
        if (FLOW_ONLY[module]?.includes(key)) continue
        if (!new RegExp(`${name}[.]${key}(?![A-Za-z0-9_])`).test(source))
          missing.push(`${name}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("a converted module's client has no callModule generic", () => {
    for (const module of CONVERTED) {
      const source = sourceOf(module)
      expect(source, `${module} client.ts`).toBeDefined()
      expect(source).not.toMatch(/callModule</)
      expect(source).not.toMatch(/onModuleEvent</)
    }
  })
})

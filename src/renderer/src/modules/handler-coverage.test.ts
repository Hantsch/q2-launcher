import { describe, expect, it } from 'vitest'
import { CONFIG_HANDLERS } from '@shared/modules/config'
import { DOWNLOADS_HANDLERS } from '@shared/modules/downloads'
import { HOME_HANDLERS } from '@shared/modules/home'
import { LIBRARY_HANDLERS } from '@shared/modules/library'
import { MODS_HANDLERS } from '@shared/modules/mods'
import { REPLAYS_HANDLERS } from '@shared/modules/replays'
import { SERVERS_HANDLERS, SERVERS_WATCHLIST_HANDLERS } from '@shared/modules/servers'
import {
  isTestFile,
  listSourceFiles,
  readRepoFile,
  stripComments,
} from '../../../test-support/source-tree'

const CLIENT_FILE = /^src\/renderer\/src\/modules\/([^/]+)\/client\.ts$/
const clients: Record<string, string> = {}
for (const file of listSourceFiles('src/renderer/src/modules')) {
  const module = CLIENT_FILE.exec(file)?.[1]
  if (module !== undefined) clients[`./${module}/client.ts`] = readRepoFile(file)
}

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

describe('renderer module clients', () => {
  it("every handler constant is referenced by its module's client", () => {
    const missing: string[] = []
    for (const { module, name, handlers } of GROUPS) {
      const raw = sourceOf(module)
      if (raw === undefined) {
        missing.push(`${module}: no client.ts`)
        continue
      }
      const source = stripComments(raw)
      for (const key of Object.keys(handlers)) {
        if (FLOW_ONLY[module]?.includes(key)) continue
        if (!new RegExp(`${name}[.]${key}(?![A-Za-z0-9_])`).test(source))
          missing.push(`${name}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every module client is built with createModuleClient', () => {
    const entries = Object.entries(clients)
    expect(entries.length).toBeGreaterThan(0)
    for (const [path, source] of entries) {
      expect(source, path).toContain('createModuleClient<')
      expect(source, path).not.toMatch(/callModule/)
      expect(source, path).not.toMatch(/onModuleEvent/)
      expect(source, path).not.toMatch(/as Outcome/)
    }
  })
})

/** The argument text of every `mockClient(` call, found by balancing parentheses. */
function mockClientSpans(source: string): string[] {
  const spans: string[] = []
  for (
    let at = source.indexOf('mockClient(');
    at !== -1;
    at = source.indexOf('mockClient(', at + 1)
  ) {
    const open = at + 'mockClient'.length
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '(') depth++
      else if (source[i] === ')' && --depth === 0) {
        spans.push(source.slice(open, i + 1))
        break
      }
    }
  }
  return spans
}

describe('renderer client mocks', () => {
  it('the span extractor flags a cast override and passes a typed one', () => {
    const cast =
      'vi.mock("./client", (o) => mockClient(o, { a: x as never }))\nconst y = z as never'
    const typed = 'vi.mock("./client", (o) => mockClient(o, { a: x }))\nconst y = z as never'
    expect(mockClientSpans(cast).filter((span) => span.includes('as never'))).toHaveLength(1)
    expect(mockClientSpans(typed).filter((span) => span.includes('as never'))).toEqual([])
  })

  it('no client mock override is cast with as never', () => {
    const files = listSourceFiles('src/renderer').filter(isTestFile)
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of files) {
      if (file.endsWith('/handler-coverage.test.ts')) continue
      const source = stripComments(readRepoFile(file))
      const wholeFile = file.endsWith('/client.test.ts')
      const hit = wholeFile
        ? source.includes('as never')
        : mockClientSpans(source).some((span) => span.includes('as never'))
      if (hit) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})

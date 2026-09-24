import { describe, expect, it } from 'vitest'

import { parseInfoReply } from './info-reply'
import { encodeLatin1, OOB_PREFIX } from './protocol'
import { buildInfoReplyBytes, SAMPLE_INFO_REPLY } from './reply-fixtures'

describe('parseInfoReply', () => {
  it('parses a well-formed info reply into hostname, map, clients and maxclients', () => {
    const result = parseInfoReply(SAMPLE_INFO_REPLY)

    expect(result).toEqual({
      ok: true,
      serverinfo: {
        gamename: 'baseq2',
        hostname: 'Test Server',
        mapname: 'q2dm1',
        clients: '3',
        maxclients: '8',
        version: '3.20',
      },
      hostname: 'Test Server',
      map: 'q2dm1',
      clients: 3,
      maxClients: 8,
    })
  })

  it('an empty serverinfo body is rejected as malformed-infostring', () => {
    expect(parseInfoReply(buildInfoReplyBytes(''))).toEqual({
      ok: false,
      reason: 'malformed-infostring',
    })
  })

  it('a status reply is rejected as unexpected-command', () => {
    const statusReply = new Uint8Array([
      ...OOB_PREFIX,
      ...encodeLatin1('status\n\\gamename\\baseq2\n'),
    ])

    expect(parseInfoReply(statusReply)).toEqual({ ok: false, reason: 'unexpected-command' })
  })

  it('a non-numeric maxclients leaves maxClients undefined while the raw string survives', () => {
    const result = parseInfoReply(buildInfoReplyBytes('\\hostname\\Test Server\\maxclients\\eight'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.maxClients).toBeUndefined()
    expect(result.serverinfo.maxclients).toBe('eight')
  })
})

import { describe, expect, it } from 'vitest'

import { parseInfoReply } from './info-reply'
import { encodeLatin1, OOB_PREFIX } from './protocol'
import { buildInfoReplyBytes, formatInfoLine, SAMPLE_INFO_REPLY } from './reply-fixtures'

describe('parseInfoReply', () => {
  it('parses a well-formed info reply into hostname, map, clients and maxclients', () => {
    const result = parseInfoReply(SAMPLE_INFO_REPLY)

    expect(result).toEqual({
      ok: true,
      serverinfo: { hostname: 'Test Server', mapname: 'q2dm1', clients: '3', maxclients: '8' },
      hostname: 'Test Server',
      map: 'q2dm1',
      clients: 3,
      maxClients: 8,
    })
  })

  it('keeps a hostname longer than 16 columns with embedded spaces intact', () => {
    // Shape observed on a live server: %16s does not truncate, so the hostname overruns its column.
    const result = parseInfoReply(buildInfoReplyBytes('Dediz Rocket Arena 2 w/ Gladiator Bots  ra2map9 11/24\n'))

    expect(result).toMatchObject({
      ok: true,
      hostname: 'Dediz Rocket Arena 2 w/ Gladiator Bots',
      map: 'ra2map9',
      clients: 11,
      maxClients: 24,
    })
  })

  it('reads space-padded single-digit counts and a zero player count', () => {
    const result = parseInfoReply(buildInfoReplyBytes(formatInfoLine('Empty', 'q2dm2', 0, 8)))

    expect(result).toMatchObject({ ok: true, hostname: 'Empty', map: 'q2dm2', clients: 0, maxClients: 8 })
  })

  it('an all-padding hostname stays undefined rather than becoming an empty string', () => {
    const result = parseInfoReply(buildInfoReplyBytes(formatInfoLine('', 'q2dm1', 1, 8)))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.hostname).toBeUndefined()
    expect(result.serverinfo).not.toHaveProperty('hostname')
    expect(result.map).toBe('q2dm1')
  })

  it('an empty body is rejected as malformed-infostring', () => {
    expect(parseInfoReply(buildInfoReplyBytes(''))).toEqual({ ok: false, reason: 'malformed-infostring' })
  })

  it('a line truncated by the 64-byte buffer is a reply with no fields, not a failure', () => {
    // Shape observed on a live server: the hostname overran the buffer and cut off the counts.
    const truncated = 'Dediz Xatrix OpenFFA [custom maps] w/ Gladiator Bots     bath  5'

    expect(parseInfoReply(buildInfoReplyBytes(truncated))).toEqual({ ok: true, serverinfo: {} })
  })

  it('a "wrong version" answer is a reply with no fields', () => {
    expect(parseInfoReply(buildInfoReplyBytes('My Server: wrong version\n'))).toEqual({ ok: true, serverinfo: {} })
  })

  it('a status reply is rejected as unexpected-command', () => {
    const statusReply = new Uint8Array([
      ...OOB_PREFIX,
      ...encodeLatin1('status\n\\gamename\\baseq2\n'),
    ])

    expect(parseInfoReply(statusReply)).toEqual({ ok: false, reason: 'unexpected-command' })
  })
})

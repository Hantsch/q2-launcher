import { describe, expect, it } from 'vitest'

import { encodeLatin1 } from './protocol'
import {
  buildStatusReplyBytes,
  SAMPLE_STATUS_REPLY,
  SAMPLE_STATUS_REPLY_SPECIAL_NAME,
  SAMPLE_STATUS_SERVERINFO_LINE,
} from './reply-fixtures'
import { parseStatusReply } from './status-reply'

describe('parseStatusReply', () => {
  it('parses a status reply into serverinfo and a player list of score, ping and name', () => {
    const result = parseStatusReply(SAMPLE_STATUS_REPLY)

    expect(result).toEqual({
      ok: true,
      serverinfo: {
        gamename: 'baseq2',
        hostname: 'Test Server',
        mapname: 'q2dm1',
        clients: '2',
        maxclients: '8',
        version: '3.20',
      },
      players: [
        { score: 3, ping: 25, name: 'PlayerOne' },
        { score: 0, ping: -1, name: 'AnotherPlayer' },
      ],
    })

    // A player carries exactly those three fields — no raw line, no index anyone could re-parse.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.players[0] as object).sort()).toEqual(['name', 'ping', 'score'])
  })

  it('a serverinfo line with no player lines is a legitimate empty server, not a failure', () => {
    // Both shapes a real server sends: no trailing newline, and one.
    for (const trailingNewline of [false, true]) {
      const result = parseStatusReply(
        buildStatusReplyBytes(SAMPLE_STATUS_SERVERINFO_LINE, [], { trailingNewline }),
      )

      expect(result.ok, `trailingNewline: ${trailingNewline}`).toBe(true)
      if (!result.ok) continue
      expect(result.players).toEqual([])
      expect(result.serverinfo.hostname).toBe('Test Server')
    }
  })

  it('a player name survives arbitrary and high-bit bytes byte-identically', () => {
    const result = parseStatusReply(SAMPLE_STATUS_REPLY_SPECIAL_NAME)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The embedded space, quote and backslash are name content, never separators: one player.
    expect(result.players).toHaveLength(1)
    const player = result.players[0] as { score: number; ping: number; name: string }
    expect(player.score).toBe(12)
    expect(player.ping).toBe(5)

    // Expected bytes written out independently of the fixture's own construction path:
    // "Pl" 0x93 "ayer " '"' "Two" '"' " " "\" "Test"
    const expectedBytes = [
      0x50, 0x6c, 0x93, 0x61, 0x79, 0x65, 0x72, 0x20, 0x22, 0x54, 0x77, 0x6f, 0x22, 0x20, 0x5c,
      0x54, 0x65, 0x73, 0x74,
    ]
    expect(Array.from(encodeLatin1(player.name))).toEqual(expectedBytes)
    expect(player.name).toBe('Player "Two" \\Test')
  })

  it('a truncated or malformed reply is a failure, never zero players', () => {
    const cases = [
      {
        label: 'cut mid-player-line: a final line with neither a ping nor a name',
        bytes: buildStatusReplyBytes(SAMPLE_STATUS_SERVERINFO_LINE, ['3 25 "PlayerOne"', '3']),
        reason: 'truncated',
      },
      {
        label: 'cut after the ping: score and ping, but no name started',
        bytes: buildStatusReplyBytes(SAMPLE_STATUS_SERVERINFO_LINE, ['3 25 "PlayerOne"', '0 42']),
        reason: 'truncated',
      },
      {
        label: 'unterminated quoted name',
        bytes: buildStatusReplyBytes(SAMPLE_STATUS_SERVERINFO_LINE, [
          '3 25 "PlayerOne"',
          '0 -1 "Anothe',
        ]),
        reason: 'truncated',
      },
      {
        label: 'cut mid-serverinfo: the line stops on a dangling key, nothing follows',
        bytes: buildStatusReplyBytes('\\gamename\\baseq2\\hostname', []),
        reason: 'truncated',
      },
      {
        label: 'cut mid-serverinfo: nothing of the serverinfo line arrived at all',
        bytes: buildStatusReplyBytes('', []),
        reason: 'malformed-infostring',
      },
      {
        label: 'non-numeric ping',
        bytes: buildStatusReplyBytes(SAMPLE_STATUS_SERVERINFO_LINE, ['3 abc "Name"']),
        reason: 'malformed-player-line',
      },
    ] as const

    for (const { label, bytes, reason } of cases) {
      const result = parseStatusReply(bytes)

      expect(result, label).toEqual({ ok: false, reason })
      // The point of the whole exercise: a failure is never dressed up as an empty — or a
      // partial — player list, which downstream could not tell from a complete one.
      expect(result.ok, label).toBe(false)
      expect(result, label).not.toHaveProperty('players')
    }
  })

  it('an info reply is rejected as unexpected-command', () => {
    const infoReply = new Uint8Array([
      0xff,
      0xff,
      0xff,
      0xff,
      ...encodeLatin1('info\n\\gamename\\baseq2'),
    ])

    expect(parseStatusReply(infoReply)).toEqual({ ok: false, reason: 'unexpected-command' })
  })

  it('an unquoted player name is taken verbatim', () => {
    const result = parseStatusReply(
      buildStatusReplyBytes(SAMPLE_STATUS_SERVERINFO_LINE, ['7 60 Unquoted Name']),
    )

    expect(result).toEqual({
      ok: true,
      serverinfo: expect.any(Object),
      players: [{ score: 7, ping: 60, name: 'Unquoted Name' }],
    })
  })
})

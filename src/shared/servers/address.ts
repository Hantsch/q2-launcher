/**
 * Validation for a server address before it is trusted anywhere in the app (story 107).
 *
 * The concept is explicit about why this cannot be an afterthought (§10.1): r1q2's `+connect`
 * argument is handled by a *late* command parser that is re-tokenized normally — unlike `+set`, it
 * honours quotes and spaces. An address string that reaches `buildLaunchArgs` unvalidated is not
 * just a wrong-hostname risk, it is a way for foreign data (a master's reply, a pasted string) to
 * inject additional tokens into the argument vector the launcher hands to the game. This is
 * CLAUDE.md's "paths from the renderer are never trusted" rule applied to a different kind of
 * untrusted value.
 *
 * Pure, `src/shared` — no `fs`, no DOM, no electron, no IPC — because three later stories (the join
 * flow, manual server entry, and the address-book write) each call the same strict check instead of
 * writing three slightly different ones; see story 107's Decisions for why this lives in its own
 * `src/shared/servers/` folder rather than in `src/shared/modules/servers.ts` (the IPC contract
 * home owned by story 106).
 *
 * ## Result shape
 *
 * Mirrors `src/shared/config/validation.ts`'s convention: a rejection carries a reason *code* (a
 * string-literal union), never a literal English message. A caller resolves the code to an i18n key
 * via `serverAddressRejectionKey()`; the actual `en.json` entries are a separate deliverable (story
 * 107, D3).
 *
 * ## Scope: IPv4 and hostnames only, no IPv6 (story 107 decision)
 *
 * The classic UDP master record format is IPv4-only, and `+connect` has never needed to carry IPv6
 * in this ecosystem. An IPv6 literal is rejected the same as any other malformed input, with its
 * own `ipv6-not-supported` reason code so the message is still specific.
 *
 * ## Character rule (AC3)
 *
 * The whole trimmed input must contain no control byte (code point < 0x20), no byte above 126
 * (code point > 0x7E), and none of `'`, `"`, `\`, `;` — this is strictly inside
 * `docs/ARCHITECTURE.md`'s documented finding that r1q2's tokenizer treats any byte above 126 as a
 * separator, so nothing this validator accepts can be re-split by the engine. A hostname label is
 * additionally restricted to `[a-z0-9-]`, 1–63 characters, no leading or trailing hyphen, 253
 * characters total for the host — the classic DNS hostname rule. An all-numeric label (e.g. the
 * labels of `1.2.3`, which is not a 4-label IPv4 candidate) is rejected too: a real hostname's
 * rightmost label (its TLD) is never all-digits, and treating an all-numeric label as invalid also
 * gives a clear, singular reason for a truncated-looking dotted-decimal string instead of letting it
 * masquerade as a hostname.
 *
 * ## IPv6-looking literal vs. generic multi-colon garbage
 *
 * Both are rejected — v1 has no IPv6 support at all — but AC5 wants a reason a user can act on, so
 * the two get different codes. The candidate (the single whitespace-token remaining after the
 * earlier checks) enters this analysis when it contains `[` or `]`, or has more than one colon.
 * Inside that set, it is judged "recognizably IPv6" (`ipv6-not-supported`) when any of these hold:
 * it contains a bracket (`[`/`]`), it contains `::` (the zero-compression idiom), or it has at least
 * three colons *and* every colon-separated segment looks like a hex group (1–4 hex digits, or
 * empty). Anything else with more than one colon — e.g. `a:b:c` with non-hex segments, or exactly
 * two colons that don't fit the hex-group shape — is `too-many-colons`: clearly not a `host:port`
 * pair, but not specifically identifiable as someone's IPv6 address either.
 *
 * ## Reason precedence
 *
 * Checked in this order, matching how a person would read a pasted address left to right: is there
 * anything here (`empty`), does it contain a forbidden byte/character (`forbidden-character`), does
 * it carry a token that looks like an engine console argument (`argument-token`), is it actually one
 * token (`extra-tokens`), does its colon/bracket shape look like `host:port` at all (`too-many-colons`
 * / `ipv6-not-supported`), is there exactly one host and one port (`missing-port`,
 * `port-not-numeric`, `port-out-of-range`), and finally is the host itself well-formed
 * (`ipv4-octet-out-of-range` or `host-empty` / `host-too-long` / `host-label-invalid`).
 */

/** Why `parseServerAddress` rejected a candidate address. */
export type ServerAddressRejection =
  | 'empty'
  | 'extra-tokens'
  | 'forbidden-character'
  | 'argument-token'
  | 'missing-port'
  | 'port-not-numeric'
  | 'port-out-of-range'
  | 'too-many-colons'
  | 'ipv6-not-supported'
  | 'host-empty'
  | 'host-too-long'
  | 'host-label-invalid'
  | 'ipv4-octet-out-of-range'

/** A successfully parsed address. */
export interface ParsedServerAddress {
  host: string
  port: number
  kind: 'ipv4' | 'hostname'
  /** Canonical `host:port` form — lowercase host, decimal port. See `formatServerAddress`. */
  normalized: string
}

export type ServerAddressResult =
  | ({ ok: true } & ParsedServerAddress)
  | { ok: false; reason: ServerAddressRejection }

/** Control bytes, bytes above 126, and the shell/argument metacharacters `'`, `"`, `\`, `;`. */
const FORBIDDEN_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\uffff'"\\;]/

/** One dotted-decimal label: all digits, used to detect an IPv4-shaped candidate. */
const ALL_DIGITS_PATTERN = /^[0-9]+$/

/** A hex group of 1–4 hex digits (or empty, for `::` zero-compression), used only to help tell an
 * IPv6-looking literal apart from generic multi-colon garbage — see the file doc comment. */
const HEX_GROUP_PATTERN = /^[0-9a-fA-F]{0,4}$/

function reject(reason: ServerAddressRejection): ServerAddressResult {
  return { ok: false, reason }
}

/** Whether `label` is a legal hostname label: 1–63 chars, `[a-z0-9-]` only, no leading/trailing
 * hyphen, and not all-digits (see the file doc comment's "Character rule" section). `label` must
 * already be lowercase. */
function isValidHostnameLabel(label: string): boolean {
  if (label.length < 1 || label.length > 63) return false
  if (!/^[a-z0-9-]+$/.test(label)) return false
  if (label.startsWith('-') || label.endsWith('-')) return false
  if (ALL_DIGITS_PATTERN.test(label)) return false
  return true
}

/** Whether `candidate` (already known to contain a bracket or more than one colon) is a
 * "recognizably IPv6" literal rather than generic multi-colon garbage. See the file doc comment. */
function looksLikeIpv6Literal(candidate: string): boolean {
  if (candidate.includes('[') || candidate.includes(']')) return true
  if (candidate.includes('::')) return true
  const colonCount = (candidate.match(/:/g) ?? []).length
  if (colonCount < 3) return false
  return candidate.split(':').every((segment) => HEX_GROUP_PATTERN.test(segment))
}

/** Classify and validate the host part once port parsing has succeeded. */
function parseHost(hostPart: string): { ok: true; host: string; kind: 'ipv4' | 'hostname' } | { ok: false; reason: ServerAddressRejection } {
  const labels = hostPart.split('.')

  const isDottedNumericCandidate = labels.length === 4 && labels.every((label) => ALL_DIGITS_PATTERN.test(label))
  if (isDottedNumericCandidate) {
    const octets: number[] = []
    for (const label of labels) {
      const malformedLeadingZero = label.length > 1 && label.startsWith('0')
      const value = Number(label)
      if (malformedLeadingZero || value < 0 || value > 255) {
        return { ok: false, reason: 'ipv4-octet-out-of-range' }
      }
      octets.push(value)
    }
    return { ok: true, host: octets.join('.'), kind: 'ipv4' }
  }

  if (hostPart.length === 0) return { ok: false, reason: 'host-empty' }
  if (hostPart.length > 253) return { ok: false, reason: 'host-too-long' }

  const lowerLabels = hostPart.toLowerCase().split('.')
  for (const label of lowerLabels) {
    if (!isValidHostnameLabel(label)) return { ok: false, reason: 'host-label-invalid' }
  }

  return { ok: true, host: lowerLabels.join('.'), kind: 'hostname' }
}

/**
 * Parses and strictly validates a `host:port` or IPv4-literal `a.b.c.d:port` address.
 *
 * Pure — no IO, no defaults filled in (a missing port is always a rejection, never defaulted to a
 * well-known Quake II port). See the file doc comment for the full reason-precedence order.
 */
export function parseServerAddress(input: string): ServerAddressResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) return reject('empty')

  if (FORBIDDEN_CHARACTER_PATTERN.test(trimmed)) return reject('forbidden-character')

  const tokens = trimmed.split(/\s+/)
  if (tokens.some((token) => token.startsWith('+'))) return reject('argument-token')
  if (tokens.length > 1) return reject('extra-tokens')

  const candidate = tokens[0] as string
  const colonCount = (candidate.match(/:/g) ?? []).length
  const hasBracket = candidate.includes('[') || candidate.includes(']')

  if (hasBracket || colonCount > 1) {
    return reject(looksLikeIpv6Literal(candidate) ? 'ipv6-not-supported' : 'too-many-colons')
  }

  if (colonCount === 0) return reject('missing-port')

  const colonIndex = candidate.indexOf(':')
  const hostPart = candidate.slice(0, colonIndex)
  const portPart = candidate.slice(colonIndex + 1)

  if (portPart.length === 0) return reject('missing-port')
  if (!ALL_DIGITS_PATTERN.test(portPart)) return reject('port-not-numeric')

  const port = Number(portPart)
  if (port < 1 || port > 65535) return reject('port-out-of-range')

  const hostResult = parseHost(hostPart)
  if (!hostResult.ok) return reject(hostResult.reason)

  return {
    ok: true,
    host: hostResult.host,
    port,
    kind: hostResult.kind,
    normalized: formatServerAddress(hostResult.host, port),
  }
}

/** Builds the canonical `host:port` form — lowercase host, decimal port. Never fills in a default
 * port; the caller must already have one. */
export function formatServerAddress(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`
}

/** Maps a rejection reason to its i18n key, `servers.address.reject.<reason>`. The actual `en.json`
 * entries are added by a later deliverable (story 107, D3) — this is just the deterministic naming
 * function. */
export function serverAddressRejectionKey(reason: ServerAddressRejection): string {
  return `servers.address.reject.${reason}`
}

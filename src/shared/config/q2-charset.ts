/**
 * Quake II's alternate console charset: the high-bit twin of the plain ASCII
 * page, used for the coloured chat/name text every player has seen. Ported
 * from the external q2-config-manager project (`src/core/encoding.ts`) —
 * only its alternate-charset and glyph portions. `decodeLatin1`,
 * `encodeLatin1`, `findUnencodable` and `byteLength` are the writer's own
 * on-disk encoding step and belong elsewhere; they are out of scope here.
 *
 * `Q2Glyph.label` is replaced by an i18n key field; the English text lives in
 * `src/renderer/src/i18n/locales/en.json` under `config.q2Charset.*`. `ascii`
 * stays literal — it is a rendering stand-in, not UI prose.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import,
 * no DOM types, no `Buffer`.
 */

export function toAltCharset(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    // Space stays a plain space: 0xA0 renders as a solid block, not a gap.
    out += c === 0x20 || c > 0x7f ? text[i] : String.fromCharCode(c | 0x80)
  }
  return out
}

export function fromAltCharset(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out += c >= 0x80 && c <= 0xff ? String.fromCharCode(c & 0x7f) : text[i]
  }
  return out
}

export function hasAltCharset(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0x80 && c <= 0xff) return true
  }
  return false
}

export interface Q2Glyph {
  byte: number
  labelKey: string
  /** A rough ASCII stand-in for UI preview when no conchars are available. */
  ascii: string
}

export const Q2_GLYPHS: Q2Glyph[] = [
  { byte: 0x0b, labelKey: 'config.q2Charset.glyph.0x0b.label', ascii: '•' },
  { byte: 0x10, labelKey: 'config.q2Charset.glyph.0x10.label', ascii: '[' },
  { byte: 0x11, labelKey: 'config.q2Charset.glyph.0x11.label', ascii: ']' },
  { byte: 0x12, labelKey: 'config.q2Charset.glyph.0x12.label', ascii: '0' },
  { byte: 0x1d, labelKey: 'config.q2Charset.glyph.0x1d.label', ascii: '<' },
  { byte: 0x1e, labelKey: 'config.q2Charset.glyph.0x1e.label', ascii: '=' },
  { byte: 0x1f, labelKey: 'config.q2Charset.glyph.0x1f.label', ascii: '>' },
  { byte: 0x80, labelKey: 'config.q2Charset.glyph.0x80.label', ascii: '▪' },
  { byte: 0x83, labelKey: 'config.q2Charset.glyph.0x83.label', ascii: '▫' },
  { byte: 0x84, labelKey: 'config.q2Charset.glyph.0x84.label', ascii: '▪' },
  { byte: 0x85, labelKey: 'config.q2Charset.glyph.0x85.label', ascii: '▪' },
  { byte: 0x86, labelKey: 'config.q2Charset.glyph.0x86.label', ascii: '▪' },
  { byte: 0x87, labelKey: 'config.q2Charset.glyph.0x87.label', ascii: '▪' },
  { byte: 0x88, labelKey: 'config.q2Charset.glyph.0x88.label', ascii: '▪' },
  { byte: 0x89, labelKey: 'config.q2Charset.glyph.0x89.label', ascii: '▪' },
  { byte: 0x8b, labelKey: 'config.q2Charset.glyph.0x8b.label', ascii: '▪' },
  { byte: 0x8d, labelKey: 'config.q2Charset.glyph.0x8d.label', ascii: '←' },
  { byte: 0x8e, labelKey: 'config.q2Charset.glyph.0x8e.label', ascii: '↑' },
  { byte: 0x8f, labelKey: 'config.q2Charset.glyph.0x8f.label', ascii: '→' },
  { byte: 0x90, labelKey: 'config.q2Charset.glyph.0x90.label', ascii: '↓' },
]

export function glyph(byte: number): string {
  return String.fromCharCode(byte)
}

/** Render a config string for display in an HTML UI. High-bit bytes are meaningless to a
 * browser font, so they are mapped back to their plain twin and flagged, letting the UI
 * colour the span green instead. */
export function toDisplaySegments(text: string): { text: string; alt: boolean }[] {
  const segments: { text: string; alt: boolean }[] = []
  let current = ''
  let currentAlt: boolean | null = null
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const alt = code >= 0x80 && code <= 0xff
    const ch = alt ? String.fromCharCode(code & 0x7f) : text[i]!
    if (currentAlt === null || alt === currentAlt) {
      current += ch
      currentAlt = alt
    } else {
      segments.push({ text: current, alt: currentAlt })
      current = ch
      currentAlt = alt
    }
  }
  if (current) segments.push({ text: current, alt: currentAlt ?? false })
  return segments
}

/**
 * Whether every character in `text` fits in a single latin1 byte
 * (U+0000–U+00FF). Needed by a later deliverable's zod schema to reject
 * config values the writer's latin1 encoding step could not round-trip.
 * The empty string is trivially latin1.
 */
export function isLatin1Text(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xff) return false
  }
  return true
}

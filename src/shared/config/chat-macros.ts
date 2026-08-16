/**
 * Chat macro facts: client-side location tokens, mod-side status tokens, and
 * the suggested team-message library built on top of them.
 *
 * Ported from the external q2-config-manager project (`src/core/macros.ts`).
 * All prose (`label`, `description`, `requires`, suggestion `label`, respawn
 * `label`) is replaced here by i18n key fields; the English text lives in
 * `src/renderer/src/i18n/locales/en.json` under `config.chatMacros.*`. `token`,
 * `scope` and `supportedBy` stay literal — they are data/citations (which
 * engine or mod actually understands this token), not UI prose, the same
 * distinction `cvar-facts.ts`'s `source:` field draws.
 */

export type MacroScope = 'client' | 'mod'

export interface ChatMacro {
  token: string
  labelKey: string
  descriptionKey: string
  scope: MacroScope
  /** Engines (client scope) or mods (mod scope) known to support this. */
  supportedBy: string[]
  /** i18n key for extra setup the macro needs before it produces anything. */
  requiresKey?: string
}

export const CHAT_MACROS: ChatMacro[] = [
  {
    token: '$$loc_here',
    labelKey: 'config.chatMacros.locHere.label',
    descriptionKey: 'config.chatMacros.locHere.description',
    scope: 'client',
    supportedBy: ['r1q2', 'q2pro'],
    requiresKey: 'config.chatMacros.locHere.requires',
  },
  {
    token: '$$loc_there',
    labelKey: 'config.chatMacros.locThere.label',
    descriptionKey: 'config.chatMacros.locThere.description',
    scope: 'client',
    supportedBy: ['r1q2', 'q2pro'],
    requiresKey: 'config.chatMacros.locThere.requires',
  },
  {
    token: '%l',
    labelKey: 'config.chatMacros.l.label',
    descriptionKey: 'config.chatMacros.l.description',
    scope: 'mod',
    supportedBy: ['Lithium II', 'OpenTDM', 'various CTF mods'],
  },
  {
    token: '%h',
    labelKey: 'config.chatMacros.h.label',
    descriptionKey: 'config.chatMacros.h.description',
    scope: 'mod',
    supportedBy: ['Lithium II', 'OpenTDM'],
  },
  {
    token: '%a',
    labelKey: 'config.chatMacros.a.label',
    descriptionKey: 'config.chatMacros.a.description',
    scope: 'mod',
    supportedBy: ['Lithium II', 'OpenTDM'],
  },
  {
    token: '%w',
    labelKey: 'config.chatMacros.w.label',
    descriptionKey: 'config.chatMacros.w.description',
    scope: 'mod',
    supportedBy: ['Lithium II'],
  },
  {
    token: '%t',
    labelKey: 'config.chatMacros.t.label',
    descriptionKey: 'config.chatMacros.t.description',
    scope: 'mod',
    supportedBy: ['CTF mods'],
  },
]

const MACRO_BY_TOKEN = new Map(CHAT_MACROS.map((m) => [m.token, m]))

export function findMacro(token: string): ChatMacro | undefined {
  return MACRO_BY_TOKEN.get(token)
}

/**
 * Find `$loc_here`-style single-dollar mistakes.
 * This is worth flagging loudly: the config looks right, the game prints no
 * error, and the message just comes out with a hole in it.
 */
export function findSingleDollarLocMistakes(
  text: string,
): { index: number; found: string; suggestion: string }[] {
  const issues: { index: number; found: string; suggestion: string }[] = []
  const re = /(?<!\$)\$(loc_here|loc_there)\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    issues.push({ index: match.index, found: match[0], suggestion: `$$${match[1]}` })
  }
  return issues
}

/** Macros present in a message, so the UI can warn about mod-only ones. */
export function macrosUsed(text: string): ChatMacro[] {
  return CHAT_MACROS.filter((m) => text.includes(m.token))
}

// Suggested team messages
export interface MessageSuggestion {
  id: string
  labelKey: string
  /** Actual message content inserted into the editor — game content, not UI chrome. */
  text: string
  group: 'status' | 'items' | 'tactics' | 'timing'
}

export const MESSAGE_SUGGESTIONS: MessageSuggestion[] = [
  { id: 'ok', labelKey: 'config.chatMacros.suggestions.ok.label', text: '[ OK ] $$loc_here', group: 'status' },
  { id: 'neg', labelKey: 'config.chatMacros.suggestions.neg.label', text: '[ NEGATIVE ]', group: 'status' },
  {
    id: 'help',
    labelKey: 'config.chatMacros.suggestions.help.label',
    text: '[ HELP ] $$loc_here',
    group: 'status',
  },
  {
    id: 'enemy',
    labelKey: 'config.chatMacros.suggestions.enemy.label',
    text: '[ ENEMY ] $$loc_there',
    group: 'status',
  },
  {
    id: 'clear',
    labelKey: 'config.chatMacros.suggestions.clear.label',
    text: '[ CLEAR ] $$loc_here',
    group: 'status',
  },
  {
    id: 'dead',
    labelKey: 'config.chatMacros.suggestions.dead.label',
    text: '[ DEAD ] $$loc_here',
    group: 'status',
  },
  {
    id: 'need_weapon',
    labelKey: 'config.chatMacros.suggestions.need_weapon.label',
    text: '[ NEED WEAPON ] $$loc_here',
    group: 'items',
  },
  {
    id: 'need_ammo',
    labelKey: 'config.chatMacros.suggestions.need_ammo.label',
    text: '[ NEED AMMO ] $$loc_here',
    group: 'items',
  },
  {
    id: 'weapon_avail',
    labelKey: 'config.chatMacros.suggestions.weapon_avail.label',
    text: '[ WEAPON FREE ] $$loc_here',
    group: 'items',
  },
  {
    id: 'armor_avail',
    labelKey: 'config.chatMacros.suggestions.armor_avail.label',
    text: '[ ARMOR FREE ] $$loc_here',
    group: 'items',
  },
  {
    id: 'take_mh',
    labelKey: 'config.chatMacros.suggestions.take_mh.label',
    text: '[ TAKE MEGAHEALTH ]',
    group: 'items',
  },
  {
    id: 'attack',
    labelKey: 'config.chatMacros.suggestions.attack.label',
    text: '[ ATTACK ] $$loc_there',
    group: 'tactics',
  },
  {
    id: 'fallback',
    labelKey: 'config.chatMacros.suggestions.fallback.label',
    text: '[ FALL BACK ]',
    group: 'tactics',
  },
  {
    id: 'push',
    labelKey: 'config.chatMacros.suggestions.push.label',
    text: '[ PUSH ] $$loc_there',
    group: 'tactics',
  },
  {
    id: 'camp_quad',
    labelKey: 'config.chatMacros.suggestions.camp_quad.label',
    text: '[ CAMPING QUAD ]',
    group: 'tactics',
  },
  {
    id: 'quad_30',
    labelKey: 'config.chatMacros.suggestions.quad_30.label',
    text: '[ QUAD IN 30 ]',
    group: 'timing',
  },
  {
    id: 'quad_60',
    labelKey: 'config.chatMacros.suggestions.quad_60.label',
    text: '[ QUAD IN 60 ]',
    group: 'timing',
  },
  {
    id: 'quad_now',
    labelKey: 'config.chatMacros.suggestions.quad_now.label',
    text: '[ QUAD NOW ]',
    group: 'timing',
  },
  {
    id: 'ps_30',
    labelKey: 'config.chatMacros.suggestions.ps_30.label',
    text: '[ POWERSHIELD IN 30 ]',
    group: 'timing',
  },
  {
    id: 'ps_60',
    labelKey: 'config.chatMacros.suggestions.ps_60.label',
    text: '[ POWERSHIELD IN 60 ]',
    group: 'timing',
  },
  {
    id: 'mh_30',
    labelKey: 'config.chatMacros.suggestions.mh_30.label',
    text: '[ MEGAHEALTH IN 30 ]',
    group: 'timing',
  },
  {
    id: 'inv_30',
    labelKey: 'config.chatMacros.suggestions.inv_30.label',
    text: '[ INVUL IN 30 ]',
    group: 'timing',
  },
]

/** Item respawn times in seconds, used by the Timings category to offer sane countdown presets. */
export const ITEM_RESPAWN_SECONDS: { id: string; labelKey: string; seconds: number }[] = [
  { id: 'quad', labelKey: 'config.chatMacros.respawn.quad.label', seconds: 60 },
  { id: 'invul', labelKey: 'config.chatMacros.respawn.invul.label', seconds: 300 },
  { id: 'megahealth', labelKey: 'config.chatMacros.respawn.megahealth.label', seconds: 20 },
  { id: 'powershield', labelKey: 'config.chatMacros.respawn.powershield.label', seconds: 60 },
  { id: 'redarmor', labelKey: 'config.chatMacros.respawn.redarmor.label', seconds: 20 },
  { id: 'yellowarmor', labelKey: 'config.chatMacros.respawn.yellowarmor.label', seconds: 20 },
  { id: 'adrenaline', labelKey: 'config.chatMacros.respawn.adrenaline.label', seconds: 60 },
  { id: 'weapon', labelKey: 'config.chatMacros.respawn.weapon.label', seconds: 30 },
  { id: 'ammo', labelKey: 'config.chatMacros.respawn.ammo.label', seconds: 30 },
]

export type MessageSegment =
  | { kind: 'text'; value: string; index: number }
  | { kind: 'meta'; value: string; index: number }
  | { kind: 'macro'; value: string; index: number }

/**
 * Recognized tokens, longest first so a longer token is never shadowed by a
 * shorter one that happens to be a prefix of it (none of today's tokens
 * actually collide this way, but the ordering is what keeps that true as the
 * table grows instead of by luck).
 */
const RECOGNIZED_TOKENS = [...CHAT_MACROS].sort((a, b) => b.token.length - a.token.length)

/**
 * Split `text` into ordered segments: literal runs (`kind: 'text'`),
 * recognized client-scope tokens (`kind: 'meta'`) and recognized mod-scope
 * tokens (`kind: 'macro'`). Recognized tokens are derived from `CHAT_MACROS`
 * rather than hardcoded again, so the two can never drift.
 *
 * A `$` that does not start one of the known tokens is left alone — it stays
 * part of the surrounding literal text, never split into its own segment.
 */
export function tokenizeMessage(text: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let textStart = 0
  let i = 0

  const flushText = (end: number): void => {
    if (end > textStart) {
      segments.push({ kind: 'text', value: text.slice(textStart, end), index: textStart })
    }
  }

  while (i < text.length) {
    const macro = RECOGNIZED_TOKENS.find((m) => text.startsWith(m.token, i))
    if (macro) {
      flushText(i)
      segments.push({
        kind: macro.scope === 'client' ? 'meta' : 'macro',
        value: macro.token,
        index: i,
      })
      i += macro.token.length
      textStart = i
    } else {
      i += 1
    }
  }
  flushText(text.length)

  return segments
}

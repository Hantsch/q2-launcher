/**
 * Human-readable labels for Quake II's standard console commands, so the
 * keyboard overview can show "Forward" instead of `+forward` - the feature
 * q2-config-manager had that this module is rebuilding (concept doc §5
 * "Overview / keyboard"). Deliberately small and only the commands players
 * actually bind (movement, combat, inventory, a handful of UI commands) -
 * anything not in here is shown verbatim rather than guessed at.
 */
const STANDARD_COMMAND_LABELS: Record<string, string> = {
  '+forward': 'Forward',
  '+back': 'Back',
  '+moveleft': 'Strafe left',
  '+moveright': 'Strafe right',
  '+moveup': 'Jump',
  '+movedown': 'Crouch',
  '+speed': 'Run / walk',
  '+attack': 'Attack',
  '+use': 'Use',
  '+strafe': 'Strafe modifier',
  '+lookup': 'Look up',
  '+lookdown': 'Look down',
  '+mlook': 'Mouse look',
  '+klook': 'Keyboard look',
  '+left': 'Turn left',
  '+right': 'Turn right',
  '+zoom': 'Zoom',
  centerview: 'Center view',
  weapnext: 'Next weapon',
  weapprev: 'Previous weapon',
  weaplast: 'Last weapon',
  invnext: 'Next item',
  invprev: 'Previous item',
  invnextw: 'Next weapon (inv)',
  invprevw: 'Previous weapon (inv)',
  invnextp: 'Next powerup',
  invprevp: 'Previous powerup',
  invuse: 'Use item',
  invdrop: 'Drop item',
  'cmd help': 'Help computer',
  'cmd inven': 'Inventory',
  'cmd score': 'Scoreboard',
  'cmd putaway': 'Put away',
  'cmd wave': 'Wave',
  say: 'Chat',
  say_team: 'Team chat',
  screenshot: 'Screenshot',
  pause: 'Pause',
  '+button2': 'Alt fire',
}

export interface CommandCatalogEntry {
  command: string
  label: string
}

/**
 * A browsable form of `STANDARD_COMMAND_LABELS`, for the keybinding editor's
 * (story 006 D4) pick list - derived from the label map rather than
 * duplicating it, so the two can never drift apart.
 */
export const COMMAND_CATALOG: CommandCatalogEntry[] = Object.entries(STANDARD_COMMAND_LABELS).map(
  ([command, label]) => ({ command, label }),
)

const WEAPON_SLOT_RE = /^weapon\s+(\d+)$/i
const USE_ITEM_RE = /^use\s+(.+)$/i

export interface ResolvedCommand {
  label: string
  recognized: boolean
}

/** Resolves one command step (never a `;`-joined chain - split first). */
export function resolveCommandLabel(step: string): ResolvedCommand {
  const trimmed = step.trim()
  const direct = STANDARD_COMMAND_LABELS[trimmed.toLowerCase()]
  if (direct) return { label: direct, recognized: true }

  const weaponMatch = trimmed.match(WEAPON_SLOT_RE)
  if (weaponMatch) return { label: `Weapon ${weaponMatch[1]}`, recognized: true }

  const useMatch = trimmed.match(USE_ITEM_RE)
  if (useMatch) return { label: `Use ${useMatch[1]}`, recognized: true }

  return { label: trimmed, recognized: false }
}

/**
 * The label shown on a keycap for a bound command: the first chained step's
 * friendly name (or its raw text if unrecognized), plus how many further
 * steps the full bind chains - visible in full in the test-mode capture.
 */
export function keycapCommandLabel(
  steps: string[],
): (ResolvedCommand & { extraSteps: number }) | null {
  if (steps.length === 0) return null
  const first = resolveCommandLabel(steps[0])
  return { ...first, extraSteps: steps.length - 1 }
}

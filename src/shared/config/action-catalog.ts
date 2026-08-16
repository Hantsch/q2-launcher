/**
 * Action catalog for the keybinding editor's built-in categories.
 *
 * Ported from the external q2-config-manager project (`src/core/catalog.ts`)
 * — movement, weapons and droppables only. Upstream's `COMMS_ACTIONS`,
 * `MISC_ACTIONS` and `KNOWN_COMMANDS` are out of scope: story 008's own
 * design decisions (4/6) limit the built-in categories to Movement, Weapons
 * and Weapon dropping. `MESSAGE_SUGGESTIONS`/`ITEM_RESPAWN_SECONDS` (upstream
 * `core/macros.ts`) are not here either — they belong with the chat-macro
 * facts in `chat-macros.ts`.
 *
 * All prose (`label`, `description`) has been replaced by `labelKey`/
 * `descriptionKey` i18n fields; the English text lives in
 * `src/renderer/src/i18n/locales/en.json` under `config.actionCatalog.*`.
 * `command`, `item`, `ammo`, `kind`, `category`, `continuous` and
 * `suggestedKeys` stay literal — they are game data, not UI prose.
 *
 * `ActionCategoryId` is narrower than upstream's: only the three categories
 * this story actually uses.
 */

export type ActionCategoryId = 'movement' | 'weapons' | 'drops'

export interface Action {
  id: string
  labelKey: string
  command: string
  category: ActionCategoryId
  descriptionKey?: string
  /** `+commands` are press/release pairs: the engine fires `+x` on key down and `-x` on key
   * up, so they must never be combined with other commands on the same key. */
  continuous?: boolean
  suggestedKeys?: string[]
}

export const MOVEMENT_ACTIONS: Action[] = [
  {
    id: 'forward',
    labelKey: 'config.actionCatalog.forward.label',
    command: '+forward',
    category: 'movement',
    continuous: true,
    suggestedKeys: ['w'],
  },
  {
    id: 'back',
    labelKey: 'config.actionCatalog.back.label',
    command: '+back',
    category: 'movement',
    continuous: true,
    suggestedKeys: ['s'],
  },
  {
    id: 'moveleft',
    labelKey: 'config.actionCatalog.moveleft.label',
    command: '+moveleft',
    category: 'movement',
    continuous: true,
    suggestedKeys: ['a'],
  },
  {
    id: 'moveright',
    labelKey: 'config.actionCatalog.moveright.label',
    command: '+moveright',
    category: 'movement',
    continuous: true,
    suggestedKeys: ['d'],
  },
  {
    id: 'moveup',
    labelKey: 'config.actionCatalog.moveup.label',
    command: '+moveup',
    category: 'movement',
    continuous: true,
    suggestedKeys: ['SPACE', 'MOUSE2'],
  },
  {
    id: 'movedown',
    labelKey: 'config.actionCatalog.movedown.label',
    command: '+movedown',
    category: 'movement',
    continuous: true,
    suggestedKeys: ['CTRL'],
  },
  {
    id: 'attack',
    labelKey: 'config.actionCatalog.attack.label',
    command: '+attack',
    category: 'movement',
    continuous: true,
    suggestedKeys: ['MOUSE1'],
  },
  {
    id: 'speed',
    labelKey: 'config.actionCatalog.speed.label',
    command: '+speed',
    category: 'movement',
    descriptionKey: 'config.actionCatalog.speed.description',
    continuous: true,
  },
  {
    id: 'strafe',
    labelKey: 'config.actionCatalog.strafe.label',
    command: '+strafe',
    category: 'movement',
    descriptionKey: 'config.actionCatalog.strafe.description',
    continuous: true,
  },
  {
    id: 'left',
    labelKey: 'config.actionCatalog.left.label',
    command: '+left',
    category: 'movement',
    continuous: true,
  },
  {
    id: 'right',
    labelKey: 'config.actionCatalog.right.label',
    command: '+right',
    category: 'movement',
    continuous: true,
  },
  {
    id: 'klook',
    labelKey: 'config.actionCatalog.klook.label',
    command: '+klook',
    category: 'movement',
    descriptionKey: 'config.actionCatalog.klook.description',
    continuous: true,
  },
  {
    id: 'mlook',
    labelKey: 'config.actionCatalog.mlook.label',
    command: '+mlook',
    category: 'movement',
    continuous: true,
  },
  {
    id: 'centerview',
    labelKey: 'config.actionCatalog.centerview.label',
    command: 'centerview',
    category: 'movement',
  },
]

export interface WeaponDef {
  id: string
  labelKey: string
  /** Exact item name the `use` and `drop` commands expect. */
  item: string
  /** Matching ammo item, needed to build a proper drop alias. */
  ammo?: string
  short: string
}

export const WEAPONS: WeaponDef[] = [
  { id: 'blaster', labelKey: 'config.actionCatalog.blaster.label', item: 'blaster', short: 'BL' },
  {
    id: 'shotgun',
    labelKey: 'config.actionCatalog.shotgun.label',
    item: 'shotgun',
    ammo: 'shells',
    short: 'SG',
  },
  {
    id: 'sshotgun',
    labelKey: 'config.actionCatalog.sshotgun.label',
    item: 'super shotgun',
    ammo: 'shells',
    short: 'SSG',
  },
  {
    id: 'machinegun',
    labelKey: 'config.actionCatalog.machinegun.label',
    item: 'machinegun',
    ammo: 'bullets',
    short: 'MG',
  },
  {
    id: 'chaingun',
    labelKey: 'config.actionCatalog.chaingun.label',
    item: 'chaingun',
    ammo: 'bullets',
    short: 'CG',
  },
  {
    id: 'grenades',
    labelKey: 'config.actionCatalog.grenades.label',
    item: 'grenades',
    short: 'HG',
  },
  {
    id: 'glauncher',
    labelKey: 'config.actionCatalog.glauncher.label',
    item: 'grenade launcher',
    ammo: 'grenades',
    short: 'GL',
  },
  {
    id: 'rlauncher',
    labelKey: 'config.actionCatalog.rlauncher.label',
    item: 'rocket launcher',
    ammo: 'rockets',
    short: 'RL',
  },
  {
    id: 'hyperblaster',
    labelKey: 'config.actionCatalog.hyperblaster.label',
    item: 'hyperblaster',
    ammo: 'cells',
    short: 'HB',
  },
  {
    id: 'railgun',
    labelKey: 'config.actionCatalog.railgun.label',
    item: 'railgun',
    ammo: 'slugs',
    short: 'RG',
  },
  { id: 'bfg', labelKey: 'config.actionCatalog.bfg.label', item: 'bfg10k', ammo: 'cells', short: 'BFG' },
]

export const WEAPON_ACTIONS: Action[] = WEAPONS.map((w) => ({
  id: `use_${w.id}`,
  labelKey: w.labelKey,
  command: `use ${w.item}`,
  category: 'weapons' as const,
  descriptionKey: `config.actionCatalog.use_${w.id}.description`,
}))

export const WEAPON_EXTRA_ACTIONS: Action[] = [
  { id: 'weapnext', labelKey: 'config.actionCatalog.weapnext.label', command: 'weapnext', category: 'weapons' },
  { id: 'weapprev', labelKey: 'config.actionCatalog.weapprev.label', command: 'weapprev', category: 'weapons' },
  { id: 'weaplast', labelKey: 'config.actionCatalog.weaplast.label', command: 'weaplast', category: 'weapons' },
]

export interface DroppableDef {
  id: string
  labelKey: string
  item: string
  ammo?: string
  kind: 'weapon' | 'ammo' | 'powerup' | 'tech'
}

export const DROPPABLES: DroppableDef[] = [
  ...WEAPONS.filter((w) => w.id !== 'blaster').map((w) => ({
    id: w.id,
    labelKey: w.labelKey,
    item: w.item,
    ...(w.ammo ? { ammo: w.ammo } : {}),
    kind: 'weapon' as const,
  })),
  { id: 'shells', labelKey: 'config.actionCatalog.shells.label', item: 'shells', kind: 'ammo' },
  { id: 'bullets', labelKey: 'config.actionCatalog.bullets.label', item: 'bullets', kind: 'ammo' },
  { id: 'rockets', labelKey: 'config.actionCatalog.rockets.label', item: 'rockets', kind: 'ammo' },
  { id: 'cells', labelKey: 'config.actionCatalog.cells.label', item: 'cells', kind: 'ammo' },
  { id: 'slugs', labelKey: 'config.actionCatalog.slugs.label', item: 'slugs', kind: 'ammo' },
  { id: 'hgrenades', labelKey: 'config.actionCatalog.hgrenades.label', item: 'grenades', kind: 'ammo' },
  {
    id: 'powershield',
    labelKey: 'config.actionCatalog.powershield.label',
    item: 'power shield',
    ammo: 'cells',
    kind: 'powerup',
  },
  {
    id: 'powerscreen',
    labelKey: 'config.actionCatalog.powerscreen.label',
    item: 'power screen',
    ammo: 'cells',
    kind: 'powerup',
  },
  { id: 'quad', labelKey: 'config.actionCatalog.quad.label', item: 'quad damage', kind: 'powerup' },
  { id: 'invuln', labelKey: 'config.actionCatalog.invuln.label', item: 'invulnerability', kind: 'powerup' },
  { id: 'silencer', labelKey: 'config.actionCatalog.silencer.label', item: 'silencer', kind: 'powerup' },
  { id: 'rebreather', labelKey: 'config.actionCatalog.rebreather.label', item: 'rebreather', kind: 'powerup' },
  {
    id: 'envsuit',
    labelKey: 'config.actionCatalog.envsuit.label',
    item: 'environment suit',
    kind: 'powerup',
  },
  { id: 'adrenaline', labelKey: 'config.actionCatalog.adrenaline.label', item: 'adrenaline', kind: 'powerup' },
  { id: 'bandolier', labelKey: 'config.actionCatalog.bandolier.label', item: 'bandolier', kind: 'powerup' },
  { id: 'ammopack', labelKey: 'config.actionCatalog.ammopack.label', item: 'ammo pack', kind: 'powerup' },
  { id: 'tech', labelKey: 'config.actionCatalog.tech.label', item: 'tech', kind: 'tech' },
]

export interface DropAction {
  id: string
  labelKey: string
  /** One `drop <item>` command per droppable item; two when an ammo item exists (weapon + its ammo). */
  commands: string[]
}

/**
 * Ready-made drop command pairs, derived from `DROPPABLES`: a droppable with
 * an `ammo` field yields both `drop <item>` and `drop <ammo>` as two separate
 * console commands, never merged into one string; a droppable without `ammo`
 * yields just `drop <item>`.
 */
export const DROP_ACTIONS: DropAction[] = DROPPABLES.map((d) => ({
  id: d.id,
  labelKey: d.labelKey,
  commands: d.ammo ? [`drop ${d.item}`, `drop ${d.ammo}`] : [`drop ${d.item}`],
}))

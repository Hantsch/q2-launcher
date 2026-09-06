import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AltLayer } from '@shared/config/alt-layers'
import type {
  ConfigAction,
  ConfigActionCategory,
  ConfigProfile,
  UnrecognizedConfigLine,
} from '@shared/modules/config'
import type { Installation } from '@shared/types'
import { aliasNameFor } from '@shared/config/alias-render'
import { isDropEntry } from '@shared/config/drop-entries'
import { scopedLogger } from '../../../lib/logger'
import { commitImport, previewImport, type ImportInstallations } from '../import'

/**
 * D9 (story 041): the importer driven end to end against the three REAL
 * fixture files - `docs/fixtures/{dm,dmalias,gfx}.cfg`, a real (anonymized)
 * player config, never modified here - rather than synthetic snippets.
 *
 * Every count and every list below was confirmed against the actual parsed
 * output before being written: `grep -c '^alias ' docs/fixtures/dmalias.cfg`
 * for the alias count, a throwaway script dumping `readImportableConfig` +
 * `buildImportedActions` output for everything else. Nothing here encodes an
 * assumption that wasn't checked against real output first - see the
 * per-item comments for what was actually found.
 */

const log = scopedLogger('import-fixtures-test')
const FIXTURES_DIR = join(__dirname, '..', '..', '..', '..', '..', 'docs', 'fixtures')

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'q2-launcher-import-fixtures-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * Copies the three real fixtures into `<root>/baseq2` byte for byte (latin1
 * in, latin1 out - same discipline as `import-reader.test.ts`'s `write`
 * helper) and writes a GENERATED `autoexec.cfg` that execs all three, exactly
 * as D9 asks for. Returns each fixture split into its raw lines so the
 * preserved-line assertions below can quote the real bytes instead of a
 * hand-retyped (and easy to get subtly wrong, given the latin1 special
 * characters some lines carry) copy.
 */
async function buildFixtureGamedir(): Promise<{
  dmLines: string[]
  dmaliasLines: string[]
  gfxLines: string[]
}> {
  const dm = await readFile(join(FIXTURES_DIR, 'dm.cfg'), 'latin1')
  const dmalias = await readFile(join(FIXTURES_DIR, 'dmalias.cfg'), 'latin1')
  const gfx = await readFile(join(FIXTURES_DIR, 'gfx.cfg'), 'latin1')

  const gamedir = join(root, 'baseq2')
  await mkdir(gamedir, { recursive: true })
  await writeFile(join(gamedir, 'dm.cfg'), Buffer.from(dm, 'latin1'))
  await writeFile(join(gamedir, 'dmalias.cfg'), Buffer.from(dmalias, 'latin1'))
  await writeFile(join(gamedir, 'gfx.cfg'), Buffer.from(gfx, 'latin1'))
  await writeFile(
    join(gamedir, 'autoexec.cfg'),
    Buffer.from('exec dm.cfg\nexec dmalias.cfg\nexec gfx.cfg\n', 'latin1'),
  )

  const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/)
  return { dmLines: splitLines(dm), dmaliasLines: splitLines(dmalias), gfxLines: splitLines(gfx) }
}

/** 1-based line lookup - throws instead of silently reading `undefined` if a line number is wrong. */
function atLine(lines: string[], n: number): string {
  const text = lines[n - 1]
  if (text === undefined) throw new Error(`fixture has no line ${n}`)
  return text
}

function fixtureInstallation(): Installation {
  return {
    id: 'fixture-install',
    name: 'Fixture install',
    rootPath: root,
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
  }
}

function installations(inst: Installation): ImportInstallations {
  return { find: (id) => (id === inst.id ? inst : undefined) }
}

describe('import against the real dm.cfg + dmalias.cfg + gfx.cfg fixtures (story 041 D9)', () => {
  it('previews the fixtures with the real alias/preserved-line facts', async () => {
    const { dmLines, dmaliasLines, gfxLines } = await buildFixtureGamedir()

    const result = await previewImport(installations(fixtureInstallation()), log, {
      installationId: 'fixture-install',
      gameDir: 'baseq2',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const preview = result.value

    expect(preview.filesRead).toEqual(['autoexec.cfg', 'dm.cfg', 'dmalias.cfg', 'gfx.cfg'])

    // dmalias.cfg has exactly 96 `alias ` lines (`grep -c '^alias '
    // docs/fixtures/dmalias.cfg`, not a guess), and none of them redefine an
    // earlier one, so all 96 make it through folding.
    expect(preview.aliasCount).toBe(96)
    expect(preview.duplicateAliases).toEqual([])
    expect(preview.duplicateBinds).toEqual([])

    // 1. Every `alias ` line became an entry - none leak into preserved as text.
    expect(preview.preserved.some((line) => line.text.startsWith('alias '))).toBe(false)

    // 6. `cali` is the only alias in the fixture whose body has a top-level
    // `bind` segment - confirmed by reading every alias body in dmalias.cfg;
    // no second candidate exists.
    expect(preview.ambiguousRebindAliases).toHaveLength(1)
    expect(preview.ambiguousRebindAliases[0]!.name).toBe('cali')
    expect(preview.ambiguousRebindAliases[0]!.file).toBe('dmalias.cfg')
    expect(preview.ambiguousRebindAliases[0]!.line).toBe(147)

    // 7. `unbindall` really is dm.cfg's first line - so it clears nothing (the
    // stream is empty before it) and every subsequent `bind` survives. dm.cfg
    // has 100 `^bind ` lines; one of them (`bind ; ""`, see below) can't
    // parse as a bind, so 99 real binds should come out the other end.
    expect(atLine(dmLines, 1)).toBe('unbindall')
    expect(preview.bindCount).toBe(99)

    // 9. The full preserved-line list, in document order (dm.cfg fully
    // expands before dmalias.cfg, which fully expands before gfx.cfg - the
    // same order `filesRead` shows above). Every line's real text is pulled
    // from the fixture itself (`atLine`), not retyped, because several carry
    // latin1-only bytes. Classified by inspecting the real output:
    //
    //  - ASCII banner junk that is NOT a `//` comment: the `<<--- .: Title
    //    :. --->>` / `##### row #####` decoration lines and the leading half
    //    of each box-drawing border (` \\---...//`, which ends in `//` but
    //    the marker sits at the very start of what follows it, so the whole
    //    line up to that trailing `//` is unrecognized command text, not a
    //    comment) - story 042 D3 does not change what any of these classify
    //    as, only where a genuine comment line's text ends up (see below).
    //  - echo banner: dm.cfg's closing `echo "..."` and dmalias.cfg's four
    //    opening `echo "..."` lines.
    //  - bare command: `m_filter 1`, `skin "..."`, `wait`, `vid_restart`,
    //    `clear`, and dmalias.cfg's `norm_fov`/`norm_sens` (the file invokes
    //    those two aliases directly, once, right after defining them).
    //  - the one oddity: dm.cfg:95 is `bind ; ""` - binding the SEMICOLON key.
    //    Because `;` is also this tokenizer's top-level command separator (it
    //    mirrors the engine's own command-buffer cut, per config-parser.ts's
    //    doc comment), the line splits into two dead fragments, `bind` and
    //    `""`, instead of one bind. That is not an importer bug: vanilla
    //    Quake II's own `Cbuf_Execute` cuts at the same unquoted `;`, so
    //    `bind ; ""` cannot bind the semicolon key in the real engine either -
    //    the fixture's own line is unbindable garbage, faithfully preserved
    //    as garbage rather than silently fixed.
    //
    // Story 042 D3: a line that is ONLY a `//` comment (dm.cfg's closing
    // half of each box border, `// wait an restart`, and every one of
    // dmalias.cfg's/gfx.cfg's colour-legend and section-header comments) is
    // ADDITIONALLY collected into `readImportableConfig`'s own `comments`
    // bucket, but keeps landing here too, unchanged from before this story
    // (AC 8 - nothing that used to survive in `preserved` stops surviving
    // there). Confirmed against the real parsed output exactly as the rest
    // of this fixture test is.
    const dmLineNumbersBefore95 = [
      3, 5, 6, 7, 9, 34, 35, 36, 38, 53, 54, 55, 56, 71, 85,
    ]
    const dmLineNumbersAfter95 = [
      99, 112, 116, 117, 118, 119, 123, 127, 128, 129, 134, 135, 136, 137, 142, 147, 151, 156, 159,
      160, 161, 169, 170, 171, 249, 250, 251, 252, 254, 255,
    ]
    const expectedDm: UnrecognizedConfigLine[] = [
      ...dmLineNumbersBefore95.map((n) => ({ file: 'dm.cfg', line: n, text: atLine(dmLines, n) })),
      { file: 'dm.cfg', line: 95, text: 'bind' },
      { file: 'dm.cfg', line: 95, text: '""' },
      ...dmLineNumbersAfter95.map((n) => ({ file: 'dm.cfg', line: n, text: atLine(dmLines, n) })),
    ]

    const dmaliasLineNumbers = [
      1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 54, 55, 114, 120, 126, 130, 134,
      146,
    ]
    const expectedDmalias: UnrecognizedConfigLine[] = dmaliasLineNumbers.map((n) => ({
      file: 'dmalias.cfg',
      line: n,
      text: atLine(dmaliasLines, n),
    }))

    // gfx.cfg's only non-command line (line 1) is a `//` comment - it is
    // ADDITIONALLY collected into `comments` but still lands here (AC 8).
    const expectedGfx: UnrecognizedConfigLine[] = [
      { file: 'gfx.cfg', line: 1, text: atLine(gfxLines, 1) },
    ]

    const expectedPreserved = [...expectedDm, ...expectedDmalias, ...expectedGfx]
    expect(expectedPreserved).toHaveLength(73)
    expect(preview.preserved).toEqual(expectedPreserved)
  })

  it('commits the fixtures into actions that resolve dm.cfg binds, chains and pairs correctly', async () => {
    const { dmaliasLines } = await buildFixtureGamedir()

    const calls: {
      name: string
      cvars: Record<string, string>
      binds: Record<string, string>
      unrecognized: UnrecognizedConfigLine[]
      actions: ConfigAction[]
      categories: ConfigActionCategory[]
      layers: AltLayer[]
    }[] = []
    const stubProfiles: ConfigProfile[] = [
      {
        id: 'fixture-profile',
        name: 'Fixture',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        cvars: {},
        binds: {},
        assignments: [],
      },
    ]
    const createProfile = (input: (typeof calls)[number]): ConfigProfile[] => {
      calls.push(input)
      return stubProfiles
    }

    const result = await commitImport(
      installations(fixtureInstallation()),
      log,
      { installationId: 'fixture-install', gameDir: 'baseq2', name: 'Fixture' },
      createProfile,
    )

    expect(result).toEqual({ ok: true, value: stubProfiles })
    expect(calls).toHaveLength(1)
    const committed = calls[0]!
    const actionByName = new Map(committed.actions.map((action) => [action.name, action]))

    // 7 (continued). Every bind after the line-1 `unbindall` survives - spot
    // checks at the first bind in the file, the last, and a couple in the
    // middle, plus the total count confirmed in the preview test above.
    expect(Object.keys(committed.binds)).toHaveLength(99)
    expect(committed.binds.ESCAPE).toBe('togglemenu') // dm.cfg:37, first bind after `unbindall`
    expect(committed.binds.MWHEELDOWN).toBe('rocket_launcher') // dm.cfg:166, last bind in the file
    expect(committed.binds.RIGHTARROW).toBe('exec dmalias.cfg') // dm.cfg:133 - text of a bound command, never a config-time exec

    // 2. `drop_shotgun`, `dall`, `s_ok`, `zoom`, `blaster` each resolve for
    // their dm.cfg binds (KP_END, KP_DEL, z, v, 3 respectively - read directly
    // off dm.cfg, cross-checked against the real alias names in dmalias.cfg).
    expect(committed.binds.KP_END).toBe('drop_shotgun') // dm.cfg:158 "Dropt Alles"
    expect(committed.binds.KP_DEL).toBe('dall')
    expect(committed.binds.z).toBe('s_ok') // dm.cfg:102
    expect(committed.binds.v).toBe('zoom') // dm.cfg:105 "zoomen"
    expect(committed.binds['3']).toBe('blaster') // dm.cfg:60
    for (const name of ['drop_shotgun', 'dall', 's_ok', 'zoom', 'blaster']) {
      expect(actionByName.has(name)).toBe(true)
    }

    // 3. wait5 -> wait20 -> wait50, and the REAL direction of the reference:
    // wait20's body calls wait5 five times, and wait50's body calls wait20
    // twice and wait5 twice - the higher number refers DOWN to the lower one,
    // not the other way round.
    //
    // Story 045, D5/D6: `wait5` (5 frames) and `wait20` (5*5 = 25 frames) both
    // resolve within MAX_WAIT_FRAMES (50) and are recognised as `waitN` aliases
    // - one surviving entry each, `commands` collapsed to a single `wait`
    // command, name kept so `wait50`'s still-raw references to both keep
    // working. `wait50` itself resolves to 2*25 + 2*5 = 60 frames, over the cap,
    // so it stays unresolved and falls through as a plain alias entry (below).
    expect(actionByName.get('wait5')!.commands).toEqual([{ kind: 'wait', frames: 5 }])
    expect(actionByName.get('wait20')!.commands).toEqual([{ kind: 'wait', frames: 25 }])
    expect(actionByName.get('wait50')!.commands).toEqual([
      { kind: 'raw', text: 'wait20' },
      { kind: 'raw', text: 'wait20' },
      { kind: 'raw', text: 'wait5' },
      { kind: 'raw', text: 'wait5' },
    ])

    // 4. The fixture's real complete +x/-x pairs. The story names six
    // candidates (+slow/-slow, +dj/-dj, +rj/-rj, +kl/-kl, +zoom/-zoom) - that
    // is already only five pairs (ten names), and all five really are
    // complete in the fixture; no sixth pair and no leftover unmatched signed
    // name exists.
    //
    // Story 045, D6: each complete pair is now recognised as one first-class
    // `kind: 'press-release'` entry (`entry-idioms.ts` via `buildImportedActions`)
    // rather than two loose `+x`/`-x` alias entries - so nothing is left with a
    // `+`/`-`-prefixed name to pair, and the committed actions themselves are
    // the source of truth here instead (story 045 D10 retired the name-based
    // `pressReleasePairs` stand-in this used to also assert against).
    const recognizedPairs = committed.actions.filter((action) => action.kind === 'press-release')
    expect(recognizedPairs.map((a) => a.name).sort()).toEqual(['dj', 'kl', 'rj', 'slow', 'zoom'])
    expect(
      committed.actions.filter(
        (action) => action.name.startsWith('+') || action.name.startsWith('-'),
      ),
    ).toEqual([])

    // 5. `blaster_settings` and its siblings: dmalias.cfg defines exactly ten
    // `alias <x>_settings ""` lines (lines 57-66), all with an empty body -
    // they survive as `commands: []` alias entries, not dropped.
    const emptyBodySiblings = [
      'blaster_settings',
      'grenades_settings',
      'shotgun_settings',
      'machinegun_settings',
      'super_shotgun_settings',
      'hyperblaster_settings',
      'chaingun_settings',
      'grenade_launcher_settings',
      'rocket_launcher_settings',
      'railgun_settings',
    ]
    expect(emptyBodySiblings).toHaveLength(10)
    for (const name of emptyBodySiblings) {
      const action = actionByName.get(name)
      expect(action).toBeDefined()
      expect(action!.commands).toEqual([])
      expect(action!.kind).toBe('alias')
    }

    // 6 (continued). With no `layerAliases` answered, `cali` (the sole
    // ambiguous alias) converts as a plain alias entry and produces no layer.
    expect(committed.layers).toEqual([])
    expect(actionByName.get('cali')).toBeDefined()

    // 8. `s_ok`'s `$g` macro and `s_spawn`'s `%h`/`%a` macros survive
    // byte-identical. Checked two ways: the exact expected text (read by hand
    // off dmalias.cfg:115/118, both plain ASCII) AND a direct containment
    // check against the real source line, so the assertion is tied to the
    // actual fixture bytes, not just a retyped copy of them.
    const sOk = actionByName.get('s_ok')!
    expect(sOk.kind).toBe('message')
    expect(sOk.commands).toEqual([
      { kind: 'message', channel: 'say_team', text: '$g [ OK / COMING ] ... $loc_here $g' },
    ])
    const sOkCommand = sOk.commands[0]!
    if (sOkCommand.kind !== 'message') throw new Error('expected s_ok to import as a message')
    expect(atLine(dmaliasLines, 115)).toContain(`say_team ${sOkCommand.text}`)

    const sSpawn = actionByName.get('s_spawn')!
    expect(sSpawn.commands).toEqual([
      { kind: 'message', channel: 'say_team', text: '$s [ STATUS ] [ $loc_here - %h:%a ] $s' },
    ])
    const sSpawnCommand = sSpawn.commands[0]!
    if (sSpawnCommand.kind !== 'message') throw new Error('expected s_spawn to import as a message')
    expect(atLine(dmaliasLines, 118)).toContain(`say_team ${sSpawnCommand.text}`)
  })

  // Story 042 D9: pins that the fixtures' USER-VISIBLE result (entry/warning/review-step wording)
  // is unchanged from 041's own expectations, and that the `preserved` bucket itself still carries
  // every one of its 73 pre-042 lines (AC 8 - the 29 comment-only lines among them are ADDITIONALLY
  // collected into the new `comments` bucket, never removed from `preserved`).
  // `dm.cfg`/`dmalias.cfg`/`gfx.cfg` carry no `[q2l ...]` metadata at all, so `restoreProfileParts`
  // (story 042 D4) must take the wholesale `buildImportedActions` delegation path for them, exactly
  // as story 041 left it - never the tagged reconstruction path, and never a metadata warning.
  it('still delegates wholesale to the untagged (story 041) path - no [q2l] tags, no metadata warnings', async () => {
    await buildFixtureGamedir()

    const result = await previewImport(installations(fixtureInstallation()), log, {
      installationId: 'fixture-install',
      gameDir: 'baseq2',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const preview = result.value

    expect(preview.ownWrittenFile).toBe(false)
    expect(preview.metadataVersion).toBeNull()
    expect(preview.sourceProfileId).toBeNull()
    expect(preview.metadataWarnings).toEqual([])
    // The `preserved` bucket's total stays at 73, exactly as it was before story 042 - the 29
    // comment-only lines among them are additionally mirrored into `comments`, never moved out of
    // `preserved`; pinned again here, explicitly, as the AC8 compatibility check this D's report
    // calls for.
    expect(preview.preserved).toHaveLength(73)
  })

  /**
   * Story 055 (AC 7, and D2's own acceptance for the import half): the fixture's sixteen `drop_*`
   * aliases arrive as drop entries and `dall` does not - over the real file, through the real
   * importer, rather than over D1's transcribed bodies (`drop-entries.test.ts`).
   *
   * It also states the property D2 must not break: an imported alias keeps its own name, because
   * `alias-import.ts` records every alias line's name in `aliasName` and `aliasNameFor` returns that
   * verbatim. Nothing about the new `drop_<slug>` derivation can reach a foreign alias - which is
   * exactly what leaves `dall` (a body of nothing but `drop` commands) a plain alias.
   */
  it('imports the sixteen drop_* aliases as drop entries and leaves `dall` a plain alias', async () => {
    await buildFixtureGamedir()

    let actions: ConfigAction[] = []
    const result = await commitImport(
      installations(fixtureInstallation()),
      log,
      { installationId: 'fixture-install', gameDir: 'baseq2', name: 'Fixture' },
      (input) => {
        actions = input.actions
        return []
      },
    )

    expect(result.ok).toBe(true)

    const drops = actions.filter(isDropEntry)
    expect(drops.map((action) => aliasNameFor(action)).sort()).toEqual([
      'drop_bullets',
      'drop_cells',
      'drop_chain',
      'drop_grenadel',
      'drop_grens',
      'drop_hyperb',
      'drop_machine',
      'drop_powers',
      'drop_rail',
      'drop_rocketl',
      'drop_rocks',
      'drop_shells',
      'drop_shotgun',
      'drop_slugs',
      'drop_sshotgun',
      'drop_tech',
    ])
    expect(drops).toHaveLength(16)

    const dall = actions.find((action) => action.name === 'dall')!
    expect(aliasNameFor(dall)).toBe('dall')
    expect(isDropEntry(dall)).toBe(false)
    // ... and that holds even though the importer files it under `drops` (its body is all `drop`
    // commands), which is the one category D2's derivation keys off: its own `aliasName` wins.
    expect(dall.categoryId).toBe('drops')
  })
})

/**
 * Story 059 D5: `dm.cfg` files every cvar under the banner it actually sits beneath - drawn with no
 * `//` marker at all (`<<--- .: General Settings :. --->>`, `config-parser.ts` classifies it as
 * `unrecognized`, never as a comment), which is exactly the shape `foreignBannerCommentText`
 * (`profile-restore.ts`) exists to recognise anyway.
 *
 * Section ATTRIBUTION and VALUE folding are two different questions (story 059 review Fix 3). The
 * 25 `set` lines under `dm.cfg`'s `General Settings` banner (lines 8-33) name 25 *distinct* cvar
 * names - `cl_vwep`, `in_mouse` and `in_joystick` are each `set` a second time further down, under
 * `Grafik Settings` (lines 186, 230, 229), but a name's SECTION is claimed by its FIRST placement
 * (the story's own decision, "a name listed twice is claimed by its first placement" - the same rule
 * a dangling `categoryId` reference already gets), independent of which `set` line's VALUE actually
 * wins at runtime (still the last one, unchanged - real engine semantics). So all three names stay
 * attributed to `General Settings`, the section they are FIRST placed under, even though their
 * stored value comes from the later `Grafik Settings` line. `m_filter` is a different case: its only
 * line above `General Settings` (line 3, `m_filter 1`) has no `set`/`seta`/`setu`/`sets` keyword, so
 * `config-parser.ts` never recognises it as a cvar assignment at all (it is a plain unrecognized
 * line) - `m_filter`'s one and only real `set` is at line 233, under `Grafik Settings`, so that is
 * where it is placed. Confirmed against the real fixture text line by line, not assumed.
 */
describe("story 059 D5: dm.cfg's own section banners become cvar sections", () => {
  const GENERAL_SETTINGS_CVARS = [
    'name',
    'crosshair',
    'hand',
    'cl_blend',
    'cl_vwep',
    'freelook',
    'in_mouse',
    'in_joystick',
    'm_pitch',
    'allow_download_maps',
    'allow_download_sounds',
    'allow_download_models',
    'allow_download_players',
    'allow_download',
    'sky',
    'adr8',
    'adr7',
    'adr6',
    'adr5',
    'adr4',
    'adr3',
    'adr2',
    'adr1',
    'adr0',
    'hostname',
  ]

  it("previews dm.cfg's General Settings banner as one cvar section carrying all 25 of its cvars, first-placement-wins", async () => {
    await buildFixtureGamedir()

    const result = await previewImport(installations(fixtureInstallation()), log, {
      installationId: 'fixture-install',
      gameDir: 'baseq2',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const general = result.value.cvarSections.find((section) => section.name === 'General Settings')
    expect(general).toBeDefined()
    expect([...general!.cvars].sort()).toEqual([...GENERAL_SETTINGS_CVARS].sort())
    // Every other cvar section the file's own banners state is still there too - this is not the
    // only section, just the one D5's acceptance names.
    expect(result.value.cvarSections.map((section) => section.name)).toContain('Grafik Settings')
  })

  it('commits dm.cfg with the same General Settings cvar section the preview reported', async () => {
    await buildFixtureGamedir()

    let committedCvarSections: { name: string; cvars: string[] }[] = []
    const result = await commitImport(
      installations(fixtureInstallation()),
      log,
      { installationId: 'fixture-install', gameDir: 'baseq2', name: 'Fixture' },
      (input) => {
        committedCvarSections = input.cvarSections
        return []
      },
    )

    expect(result.ok).toBe(true)
    const general = committedCvarSections.find((section) => section.name === 'General Settings')
    expect(general).toBeDefined()
    expect([...general!.cvars].sort()).toEqual([...GENERAL_SETTINGS_CVARS].sort())
  })

  /**
   * Story 059 review Fix 3: placement (first occurrence) and value (last occurrence) are decoupled
   * on purpose - `cl_vwep` stays placed under `General Settings` (its first `set`, line 13) even
   * though the value actually stored is `Grafik Settings`' later one (line 186), matching real
   * engine semantics for a repeated `set`. `m_filter` is placed under `Grafik Settings` (its only
   * real `set`, line 233) and does NOT appear in `General Settings` at all - the bare `m_filter 1` at
   * line 3 has no `set` keyword, so it is never a cvar assignment in the first place.
   */
  it('keeps first-placement for section attribution independent of last-value-wins for the stored value', async () => {
    await buildFixtureGamedir()

    let committedCvars: Record<string, string> = {}
    let committedCvarSections: { name: string; cvars: string[] }[] = []
    const result = await commitImport(
      installations(fixtureInstallation()),
      log,
      { installationId: 'fixture-install', gameDir: 'baseq2', name: 'Fixture' },
      (input) => {
        committedCvars = input.cvars
        committedCvarSections = input.cvarSections
        return []
      },
    )

    expect(result.ok).toBe(true)
    // The engine's own semantics: the later `set` really did win.
    expect(committedCvars.cl_vwep).toBe('1')
    expect(committedCvars.m_filter).toBe('1')

    const general = committedCvarSections.find((section) => section.name === 'General Settings')
    const grafik = committedCvarSections.find((section) => section.name === 'Grafik Settings')
    expect(general!.cvars).toContain('cl_vwep')
    expect(general!.cvars).not.toContain('m_filter')
    expect(grafik!.cvars).toContain('m_filter')
    expect(grafik!.cvars).not.toContain('cl_vwep')
  })

  /**
   * Story 059 review round 2, Fix B: the dm.cfg-based test right above only proves the pipeline
   * doesn't crash on a repeated `set` - `cl_vwep`/`m_filter` happen to carry the SAME value at both
   * their first and second occurrence in the real fixture (lines 13/186, 15/230, 16/229), so that
   * assertion would still pass even if last-value-wins folding were silently broken and the value
   * came from the FIRST occurrence instead of the last. This is a small, hand-written synthetic
   * fixture built specifically so the two banners disagree on the value, which genuinely
   * distinguishes "placed under its first banner" from "valued from its last `set`".
   */
  it('decouples first-placement from last-value-wins with a synthetic fixture where the two banners disagree on the value', async () => {
    const gamedir = join(root, 'baseq2')
    await mkdir(gamedir, { recursive: true })
    const synthetic = [
      '<<--------------------------- .: First Banner :. ----------------------------->>',
      'set probe_cvar "1"',
      '<<--------------------------- .: Second Banner :. ----------------------------->>',
      'set probe_cvar "2"',
      'set other_cvar "x"',
      '',
    ].join('\n')
    await writeFile(join(gamedir, 'config.cfg'), Buffer.from(synthetic, 'latin1'))

    let committedCvars: Record<string, string> = {}
    let committedCvarSections: { name: string; cvars: string[] }[] = []
    const result = await commitImport(
      installations(fixtureInstallation()),
      log,
      { installationId: 'fixture-install', gameDir: 'baseq2', name: 'Fixture' },
      (input) => {
        committedCvars = input.cvars
        committedCvarSections = input.cvarSections
        return []
      },
    )

    expect(result.ok).toBe(true)
    // The value stored is the LAST `set` - "Second Banner"'s "2", not "First Banner"'s "1".
    expect(committedCvars.probe_cvar).toBe('2')

    // The placement is still the FIRST banner it was ever seen under - "First Banner" - not the
    // banner that won the value.
    const first = committedCvarSections.find((section) => section.name === 'First Banner')
    const second = committedCvarSections.find((section) => section.name === 'Second Banner')
    expect(first!.cvars).toContain('probe_cvar')
    expect(second!.cvars).not.toContain('probe_cvar')
  })

  // Acceptance's second half: a file with no recognisable banner at all - `gfx.cfg`'s own lone
  // `//	[GRAFIK SETTINGS]` comment matches none of `scanComments`' recognisers (no `BANNER_RULE`
  // dashes/equals run, no `mirroredWrapTitle`/`decorationWrap` shape), so every one of its cvars
  // stays unplaced - the reserved `Other` bucket, which is the *absence* of a `ConfigCvarSection`,
  // never a minted one (see `profile-restore.ts`'s own "Cvar sections" doc comment).
  it('imports a file with no cvar banners at all with an empty cvarSections - every cvar in the reserved Other bucket', async () => {
    const gamedir = join(root, 'baseq2')
    await mkdir(gamedir, { recursive: true })
    const gfx = await readFile(join(FIXTURES_DIR, 'gfx.cfg'), 'latin1')
    await writeFile(join(gamedir, 'config.cfg'), Buffer.from(gfx, 'latin1'))

    const preview = await previewImport(installations(fixtureInstallation()), log, {
      installationId: 'fixture-install',
      gameDir: 'baseq2',
    })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.value.cvarCount).toBeGreaterThan(0)
    expect(preview.value.cvarSections).toEqual([])

    let committedCvarSections: unknown
    const commitResult = await commitImport(
      installations(fixtureInstallation()),
      log,
      { installationId: 'fixture-install', gameDir: 'baseq2', name: 'Fixture' },
      (input) => {
        committedCvarSections = input.cvarSections
        return []
      },
    )
    expect(commitResult.ok).toBe(true)
    expect(committedCvarSections).toEqual([])
  })
})

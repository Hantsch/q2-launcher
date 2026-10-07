import { describe, expect, it } from 'vitest'
import { formatMetaTag } from '@shared/config/profile/profile-metadata'
import { COMMENT_LINE_BUDGET, COMMENT_PREFIX } from '@shared/config/render/render'
import { foreignBannerCommentText } from '@shared/config/profile/profile-restore'
import type { RestoreProfilePartsResult } from '@shared/config/profile/profile-restore'
import { doc, tagged, keysOf, type DocBuilder } from './profile-restore.test-helpers'

describe('restoreProfileParts - toggle and press/release entries (story 045)', () => {
  /** A healthy toggle family exactly as the writer emits it, dispatch bound to `v`. */
  function toggleFile(): DocBuilder {
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias(
      'zoom_s1',
      'fov 30; sensitivity 1.5; alias zoom zoom_s2',
      tagged('Zoom', { lbl: 'In' }),
    )
    file.alias('zoom_s2', 'fov 90; alias zoom zoom_s1', tagged('Zoom', { lbl: 'Out' }))
    file.alias('zoom', 'zoom_s1', tagged('Zoom'))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('v', 'zoom', tagged('Zoom'))
    return file
  }

  it('folds the trio into one toggle entry with both states, both labels and the dispatch key', () => {
    const result = toggleFile().restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toHaveLength(1)
    const entry = result.actions[0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.name).toBe('Zoom')
    expect(entry.aliasName).toBe('zoom')
    expect(entry.categoryId).toBe('movement')
    // `commands` stays empty for a two-part kind - `ConfigAction.parts`' own contract.
    expect(entry.commands).toEqual([])
    expect(entry.parts).toEqual([
      {
        commands: [
          { kind: 'raw', text: 'fov 30' },
          { kind: 'raw', text: 'sensitivity 1.5' },
        ],
        label: 'In',
        aliasName: 'zoom_s1',
      },
      {
        commands: [{ kind: 'raw', text: 'fov 90' }],
        label: 'Out',
        aliasName: 'zoom_s2',
      },
    ])
    expect(keysOf(entry)).toEqual(['v'])
  })

  it('keeps the state names verbatim, so an imported trio re-renders under its own names', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('zoomin', 'zoom_fov; zoom_sens; alias zoom zoomout', tagged('Zoom'))
    file.alias('zoomout', 'norm_fov; norm_sens; alias zoom zoomin', tagged('Zoom'))
    file.alias('zoom', 'zoomin', tagged('Zoom'))

    const entry = file.restore().actions[0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.parts?.map((part) => part.aliasName)).toEqual(['zoomin', 'zoomout'])
    // No `lbl` on either line, so neither part invents a label.
    expect(entry.parts?.every((part) => part.label === undefined)).toBe(true)
  })

  it('folds a chunk-split state, whose dispatch rewrite hides inside the last `_p<n>` line', () => {
    // The shape `alias-render.ts#chunkHalf` writes once a state outgrows one line: the state's own
    // body is nothing but the chunk names, and the `alias zoom zoom_s2` rewrite that identifies it
    // as a state at all sits in `zoom_s1_p2`. `entry-idioms.ts` cannot see through that on its own
    // (its own doc comment says so) - this is the case that fails if D7 hands it unfolded bodies.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('zoom_s1_p1', 'fov 30; sensitivity 1.5', tagged('Zoom'))
    file.alias('zoom_s1_p2', 'cl_gun 0; alias zoom zoom_s2', tagged('Zoom'))
    file.alias('zoom_s1', 'zoom_s1_p1; zoom_s1_p2', tagged('Zoom', { lbl: 'In' }))
    file.alias('zoom_s2', 'fov 90; cl_gun 2; alias zoom zoom_s1', tagged('Zoom', { lbl: 'Out' }))
    file.alias('zoom', 'zoom_s1', tagged('Zoom'))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('v', 'zoom', tagged('Zoom'))

    const result = file.restore()
    expect(result.actions).toHaveLength(1)
    const entry = result.actions[0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.parts?.[0]).toEqual({
      commands: [
        { kind: 'raw', text: 'fov 30' },
        { kind: 'raw', text: 'sensitivity 1.5' },
        { kind: 'raw', text: 'cl_gun 0' },
      ],
      label: 'In',
      aliasName: 'zoom_s1',
    })
    expect(keysOf(entry)).toEqual(['v'])
  })

  it('falls back to plain alias entries for a cross-wired trio, with no warning of its own', () => {
    // Both states reassign the dispatch to `zoom_s1` - the hand edit the story's test plan asks for.
    // D5 rejects the whole shape (its three names are not pairwise distinct), so all three lines
    // restore as the plain entries they read as, which is what D8's `toggleCrossWired` reports on.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('zoom_s1', 'fov 30; alias zoom zoom_s1', tagged('Zoom', { lbl: 'In' }))
    file.alias('zoom_s2', 'fov 90; alias zoom zoom_s1', tagged('Zoom', { lbl: 'Out' }))
    file.alias('zoom', 'zoom_s1', tagged('Zoom'))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('v', 'zoom', tagged('Zoom'))

    const result = file.restore()
    expect(result.actions).toHaveLength(3)
    expect(result.actions.map((action) => action.aliasName)).toEqual(['zoom_s1', 'zoom_s2', 'zoom'])
    // Never half a toggle: no entry carries `parts` at all.
    expect(result.actions.some((action) => action.parts !== undefined)).toBe(false)
    // The bodies survive whole, rewrite segment included - the fallback loses nothing.
    expect(result.actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'fov 30' },
      { kind: 'raw', text: 'alias zoom zoom_s1' },
    ])
    // No new restore-time warning: a body wired unusually contradicts no tag, and reporting the
    // broken shape is D8's Care job, on these very fallback entries.
    expect(result.warnings).toEqual([])
  })

  it('does not merge a trio whose lines disagree about their display prose', () => {
    // Story 050 made the comment's prose the entry's identity, and the writer puts the entry's one
    // display name on every line of its alias family. Three lines wired like a toggle but named
    // three different things are three entries, and merging them would drop two names from the file.
    const file = toggleFile()
    file.alias('other_s1', 'fov 30; alias other other_s2', tagged('State one', { lbl: 'In' }))
    file.alias('other_s2', 'fov 90; alias other other_s1', tagged('State two', { lbl: 'Out' }))
    file.alias('other', 'other_s1', tagged('Dispatch'))

    const result = file.restore()
    // The healthy trio still merges; the disagreeing one stays three plain entries.
    expect(result.actions.filter((action) => action.kind === 'toggle')).toHaveLength(1)
    expect(result.actions.filter((action) => action.aliasName?.startsWith('other'))).toHaveLength(3)
  })

  it('folds a `+x`/`-x` pair into one press/release entry keyed off the `+` half', () => {
    // `bindValueFor` mirrors a press/release entry as `+slow` verbatim, so the bind line's value
    // groups with the PRESS half's own alias name - there is no group named after the bare base.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('+slow', 'cl_forwardspeed 110; cl_sidespeed 110', tagged('Slow'))
    file.alias('-slow', 'cl_forwardspeed 200; cl_sidespeed 200', tagged('Slow'))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('SHIFT', '+slow', tagged('Slow'))

    const result = file.restore()
    expect(result.actions).toHaveLength(1)
    const entry = result.actions[0]!
    expect(entry.kind).toBe('press-release')
    expect(entry.name).toBe('Slow')
    // The sign-free base, so `+`/`-` stay a render-time affix and the halves cannot drift (AC3).
    expect(entry.aliasName).toBe('slow')
    expect(entry.commands).toEqual([])
    expect(entry.parts).toEqual([
      {
        commands: [
          { kind: 'raw', text: 'cl_forwardspeed 110' },
          { kind: 'raw', text: 'cl_sidespeed 110' },
        ],
      },
      {
        commands: [
          { kind: 'raw', text: 'cl_forwardspeed 200' },
          { kind: 'raw', text: 'cl_sidespeed 200' },
        ],
      },
    ])
    expect(keysOf(entry)).toEqual(['SHIFT'])
    expect(result.warnings).toEqual([])
  })

  it('leaves a `+x` with no `-x` as the plain alias entry it is', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('+slow', 'cl_forwardspeed 110', tagged('Slow'))

    const entry = file.restore().actions[0]!
    expect(entry.kind).toBe('alias')
    expect(entry.aliasName).toBe('+slow')
    expect(entry.parts).toBeUndefined()
  })

  it('merges a half whose prose the line budget cut - and only at the exact cut point', () => {
    // Story-045 review round 2, finding 2. The `+` half's line records how wide its code was, so
    // this reader can reproduce what `fitProseAndTag` would have written there for the whole name
    // and compare. `Slow mo` is that cut at 7 characters of room; `Slow` and `Slow motion` are not,
    // and a rule that took any prefix would have merged all three away.
    const roomFor = (prose: string): number =>
      COMMENT_LINE_BUDGET - COMMENT_PREFIX.length + 2 - formatMetaTag({}).length - 1 - prose.length
    const pair = (prose: string, codeWidth?: number): RestoreProfilePartsResult => {
      const file = doc()
      file.version()
      file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
      file.alias('+slow', 'cl_forwardspeed 110', tagged(prose), codeWidth)
      file.alias('-slow', 'cl_forwardspeed 200', tagged('Slow motion walk'))
      return file.restore()
    }

    const merged = pair('Slow mo', roomFor('Slow mo'))
    expect(merged.actions).toHaveLength(1)
    expect(merged.actions[0]!.kind).toBe('press-release')
    // The whole name, not the cut spelling - the next render writes it back onto both lines.
    expect(merged.actions[0]!.name).toBe('Slow motion walk')

    // A prefix that is *not* what that room would have produced: two names, two entries.
    expect(pair('Slow', roomFor('Slow mo')).actions).toHaveLength(2)
    // Enough room for the whole name means nothing was cut - so `Slow mo` is a name of its own.
    expect(pair('Slow mo', roomFor('Slow motion walk')).actions).toHaveLength(2)
    // No recorded code width at all: nothing can prove a cut, and the safe answer is two entries.
    expect(pair('Slow mo').actions).toHaveLength(2)
  })

  it('does not merge two `+x`/`-x` alias entries the file names differently', () => {
    // The shape `fixtures/profiles.ts#pressReleaseAndEmptyAliasProfile` has carried since story 042:
    // two independent `kind: 'alias'` entries that happen to be named `+slow`/`-slow`. Merging them
    // would put one display name on both lines and lose the other on the next render.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('+slow', 'cl_forwardspeed 110', tagged('Slow walk'))
    file.alias('-slow', 'cl_forwardspeed 200', tagged('Slow walk (release)'))

    const result = file.restore()
    expect(result.actions).toHaveLength(2)
    expect(result.actions.map((action) => action.kind)).toEqual(['alias', 'alias'])
  })

  it('does not merge a state that claims a key of its own', () => {
    // A `bind` on a state is a shape the writer never emits (it binds the dispatch and nothing
    // else). Merging would move that key onto the dispatch value and rewrite a line the user typed.
    const file = toggleFile()
    file.bind('n', 'zoom_s1', tagged('Zoom'))

    const result = file.restore()
    expect(result.actions.some((action) => action.kind === 'toggle')).toBe(false)
    expect(result.actions).toHaveLength(3)
  })

  it('collapses a launcher-written run of literal `wait` segments back into one command', () => {
    // AC6 for the plain-alias case, nothing to do with the two new kinds: `commandLineFor` writes a
    // `{ kind: 'wait', frames: 5 }` command as five literal `wait` segments, so reading five back as
    // five raw commands would cost the entry its wait-row identity on every reload.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('hop_wait', 'wait; wait; wait; wait; wait', tagged('Hop wait'))
    file.alias('rocket_jump', '+moveup; wait; wait; +attack; wait; -attack', tagged('Rocket jump'))

    const [hop, jump] = file.restore().actions
    expect(hop!.commands).toEqual([{ kind: 'wait', frames: 5 }])
    expect(jump!.commands).toEqual([
      { kind: 'raw', text: '+moveup' },
      { kind: 'wait', frames: 2 },
      { kind: 'raw', text: '+attack' },
      { kind: 'wait', frames: 1 },
      { kind: 'raw', text: '-attack' },
    ])
  })

  it('does not resolve a `waitN` family away - the reference has to keep working', () => {
    // `entry-idioms.ts` can resolve `wait20` to a frame count, which is right for a foreign config
    // (D6) and wrong here: rewriting `wait5; wait5; wait5; wait5` as twenty literal waits would
    // silently drop four references the user's other bodies may still call, and the file would come
    // back different from the one that was read.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('wait5', 'wait; wait; wait; wait; wait', tagged('Wait 5'))
    file.alias('wait20', 'wait5; wait5; wait5; wait5', tagged('Wait 20'))

    const [five, twenty] = file.restore().actions
    expect(five!.commands).toEqual([{ kind: 'wait', frames: 5 }])
    expect(twenty!.commands).toEqual([
      { kind: 'raw', text: 'wait5' },
      { kind: 'raw', text: 'wait5' },
      { kind: 'raw', text: 'wait5' },
      { kind: 'raw', text: 'wait5' },
    ])
  })
})

describe('foreignBannerCommentText (story 059 D5)', () => {
  it("peels dm.cfg's own double-wrapped banner and hands back a mirroredWrapTitle-shaped inner title", () => {
    const raw =
      '<<--------------------------- .: General Settings :. ----------------------------->>'
    expect(foreignBannerCommentText(raw)).toBe('.: General Settings :.')
  })

  it('recognises a marker-less repeated-decoration sub-header unchanged, same as decorationWrap', () => {
    expect(foreignBannerCommentText('      ########## 1st row ##########')).toBe(
      '########## 1st row ##########',
    )
  })

  it('recognises a plain mirrored wrap with no outer bracket layer at all', () => {
    expect(foreignBannerCommentText(' .: Main Key`s :.')).toBe('.: Main Key`s :.')
  })

  it('does not mistake an ordinary command line for a banner', () => {
    expect(foreignBannerCommentText('vid_restart')).toBeNull()
    expect(foreignBannerCommentText('echo "real DArKStar config"')).toBeNull()
    expect(foreignBannerCommentText('   ')).toBeNull()
  })

  it('rejects an asymmetric outer wrap - open and close delimiters must be real mirrors', () => {
    // `<<` mirrors to `>>`, never to itself - a line closing with the wrong bracket is not this
    // writer's own decoration, so peeling must not silently accept it.
    expect(foreignBannerCommentText('<<--- .: Title :. ---<<')).toBeNull()
  })
})

/**
 * Story 059 D5: the same wiring `import.ts#mergeForeignBannerComments` does - a marker-less banner
 * line recognised by `foreignBannerCommentText` and merged into `comments` - reproduced directly at
 * this layer, so the cvar-section attribution this deliverable is actually about is pinned against
 * `restoreProfileParts` itself, not only against the end-to-end importer.
 */
describe('restoreProfileParts - cvar sections from a marker-less foreign banner (story 059 D5)', () => {
  it('files cvars under a banner drawn with no `//` marker at all, once its text is recognised', () => {
    const file = doc('dm.cfg')
    const banner = foreignBannerCommentText(
      '<<--------------------------- .: General Settings :. ----------------------------->>',
    )!
    file.comment(banner)
    file.cvar('hostname', '"DArKStar\'s Server"')
    file.cvar('cl_blend', '"0"')
    file.comment(
      foreignBannerCommentText(
        '<<--------------------------- .: Grafik Settings :. ----------------------------->>',
      )!,
    )
    file.cvar('gl_picmip', '"10"')

    const result = file.restore()

    expect(result.cvarSections.map((section) => section.name)).toEqual([
      'General Settings',
      'Grafik Settings',
    ])
    const general = result.cvarSections.find((section) => section.name === 'General Settings')!
    expect([...general.cvars].sort()).toEqual(['cl_blend', 'hostname'])
    const grafik = result.cvarSections.find((section) => section.name === 'Grafik Settings')!
    expect(grafik.cvars).toEqual(['gl_picmip'])
  })

  it('leaves every cvar unplaced when the file has no recognisable banner at all', () => {
    const file = doc('gfx.cfg')
    file.comment('\t[GRAFIK SETTINGS]') // gfx.cfg's own real, unrecognised comment
    file.cvar('gl_jpg_quality', '"85"')
    file.cvar('cl_maxfps', '"120"')

    const result = file.restore()

    expect(result.cvarSections).toEqual([])
  })

  /**
   * Story 059 review Fix 4: 053 D4's repeated-decoration sub-header heuristic
   * (`heuristicSubcategoryParent`) already promotes a `#####`-style marker-less sub-banner into a
   * real `Section.kind: 'subcategory'` for the BIND side (`applyForeignSubcategoryHeuristic`'s own
   * test above, "promotes an adjacent untagged pair into a category with real sub-categories"), but
   * `cvarSectionKeyFor` had no branch for that kind at all, so a `set` line under the very same
   * sub-banner fell through to `null` and read back unplaced. A top-level `set`-bearing banner
   * followed by a `#####`-style sub-banner that ALSO has `set` lines under it is exactly the case
   * that was silently dropping cvars.
   */
  it('files cvars under a repeated-decoration sub-banner exactly as the bind side already does', () => {
    const file = doc('dm.cfg')
    file.comment(
      foreignBannerCommentText(
        '<<--------------------------- .: General Settings :. ----------------------------->>',
      )!,
    )
    file.cvar('hostname', '"DArKStar\'s Server"')
    file.comment(' ##### 1st row #####')
    file.cvar('cl_blend', '"0"')
    file.comment(' ##### 2nd row #####')
    file.cvar('cl_vwep', '"1"')

    const result = file.restore()

    expect(result.cvarSections.map((section) => section.name)).toEqual(['General Settings'])
    const general = result.cvarSections[0]!
    // The ungrouped run under the top-level banner keeps only what sits directly under it.
    expect(general.cvars).toEqual(['hostname'])
    expect(general.subsections?.map((sub) => sub.name)).toEqual(['1st row', '2nd row'])
    expect(general.subsections![0]!.cvars).toEqual(['cl_blend'])
    expect(general.subsections![1]!.cvars).toEqual(['cl_vwep'])
  })
})

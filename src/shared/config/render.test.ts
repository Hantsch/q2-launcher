/**
 * Story 052 D2: the unbound line - `render.ts` emits a commented-out
 * `//bind "<cmd>"   // <name> [q2l …]` into the `Entries: <cat>` section for any entry that would
 * otherwise leave no trace in the file at all, sibling to the existing anchor line and read back
 * through the same category-scoped matcher (a later deliverable, D3, is what teaches
 * `profile-restore.ts` to claim it - this file only covers what the writer produces).
 */

import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '../modules/config'
import { STANDARD_TEMPLATE } from '../modules/config'
import { aliasNameFor } from './alias-render'
import { adoptRawBinds } from './bind-adoption'
import { renderProfileFile } from './render'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

function baseProfile(id: string, overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id,
    name: id,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

/**
 * A profile seeded exactly the way `profiles.ts#create` seeds a `from: 'template'` profile (story
 * 052 D1): the template's own categories/actions/binds, copied rather than shared (so a test
 * mutating one profile's actions can never leak into another), then run through the same
 * `adoptRawBinds` pass every real profile goes through on `commit()` - which is what turns the
 * template's six bare `binds` entries into real `keys` slots on their matching actions. Skipping
 * that pass would leave those six actions keyless in the test fixture even though a profile
 * created through the real IPC path never is, which is exactly backwards for a test whose point is
 * "a bound entry keeps rendering as it does today".
 */
function templateProfile(id = 'fixture-template'): ConfigProfile {
  const seed = baseProfile(id, {
    name: 'Standard template',
    cvars: { ...STANDARD_TEMPLATE.cvars },
    binds: { ...STANDARD_TEMPLATE.binds },
    categories: STANDARD_TEMPLATE.categories.map((category) => ({ ...category })),
    actions: STANDARD_TEMPLATE.actions.map((action) => ({ ...action })),
  })
  let nextId = 0
  const adopted = adoptRawBinds(seed, () => `adopted-${nextId++}`)
  return { ...seed, binds: adopted.binds, actions: adopted.actions }
}

/** Every line of a rendered file, split for line-scoped assertions. */
function renderedLines(profile: ConfigProfile): string[] {
  return renderProfileFile(profile).split('\n')
}

describe('render: the unbound line (story 052 D2)', () => {
  it('a seeded, unbound template profile renders exactly one //bind line per unbound row', () => {
    const profile = templateProfile()
    const actions = profile.actions!
    const lines = renderedLines(profile)

    // The template's own six rows (five continuous movement commands plus +attack) already carry
    // a real key, a real command and a real bind line - `STANDARD_TEMPLATE`'s own doc comment: every
    // other row's `commands` is `[]`.
    const boundActions = actions.filter((action) => action.commands.length > 0)
    const unboundActions = actions.filter((action) => action.commands.length === 0)

    // Every unbound row (they all seed with `commands: []` - story 052 D1) gets exactly one
    // commented-out `//bind ""` line, tagged with its own catalogue id.
    expect(unboundActions.length).toBeGreaterThan(0)
    for (const action of unboundActions) {
      expect(action.commands).toEqual([])
      const matches = lines.filter(
        (line) => line.startsWith('//bind ""') && line.includes(`cid=${action.catalogId}`),
      )
      expect(matches, `expected exactly one unbound line for "${action.name}"`).toHaveLength(1)
    }

    // None of the template's six bound rows produce a second, commented-out trace next to their
    // real bind line - "one fact, one place".
    for (const action of boundActions) {
      const commandText = action.commands[0]?.kind === 'raw' ? action.commands[0].text : ''
      const realBindLines = lines.filter((line) => line.startsWith(`bind`) && line.includes(`"${commandText}"`))
      expect(realBindLines, `expected exactly one real bind line for "${action.name}"`).toHaveLength(1)
      const unboundLines = lines.filter(
        (line) => line.startsWith('//bind') && line.includes(`cid=${action.catalogId}`),
      )
      expect(unboundLines, `"${action.name}" must not get a second, unbound trace`).toHaveLength(0)
    }
  })

  it('renders the Entries: <cat> section for a template category even when every row in it is unbound', () => {
    const profile = templateProfile()
    const rendered = renderProfileFile(profile)
    expect(rendered).toContain('// --- Entries: Movement')
    expect(rendered).toContain('// --- Entries: Weapons')
    expect(rendered).toContain('// --- Entries: Weapon dropping')
  })

  it('a bound entry (real commands, real key) renders exactly as before - no second trace', () => {
    const action: ConfigAction = {
      id: 'a1',
      categoryId: 'weapons',
      name: 'SSG SG',
      kind: 'bind',
      keys: [{ key: 'q' }],
      commands: [{ kind: 'raw', text: 'use shotgun' }, { kind: 'raw', text: 'use sshotgun' }],
    }
    // The mirror value the writer's own bind-owner index actually recognises.
    const profile = baseProfile('fixture-bound', {
      binds: { q: aliasNameFor(action) },
      actions: [action],
    })

    const lines = renderedLines(profile)
    const referencingLines = lines.filter((line) => line.includes('SSG SG'))
    // Exactly the alias line and the bind line - two real lines, never a third (commented) one.
    expect(referencingLines).toHaveLength(2)
    expect(referencingLines.some((line) => line.startsWith('alias'))).toBe(true)
    expect(referencingLines.some((line) => line.startsWith('bind'))).toBe(true)
    expect(lines.some((line) => line.includes('Entries:'))).toBe(false)
    expect(lines.some((line) => line.startsWith('//bind'))).toBe(false)
  })

  it('an unbound entry with a real (unbound) command carries that command as the line body', () => {
    const action: ConfigAction = {
      id: 'a2',
      categoryId: 'movement',
      name: 'Strafe left',
      kind: 'bind',
      catalogId: 'movement:moveleft',
      commands: [{ kind: 'raw', text: '+moveleft' }],
    }
    const profile = baseProfile('fixture-unbound-command', { actions: [action] })

    const rendered = renderProfileFile(profile)
    expect(rendered).toContain('//bind "+moveleft"')
    expect(rendered).toContain('[q2l cid=movement:moveleft]')
  })

  it('an unbound entry with no commands at all renders an empty //bind "" line', () => {
    const action: ConfigAction = {
      id: 'a3',
      categoryId: 'movement',
      name: 'Crouch',
      kind: 'bind',
      catalogId: 'movement:crouch',
      commands: [],
    }
    const profile = baseProfile('fixture-unbound-empty', { actions: [action] })

    const rendered = renderProfileFile(profile)
    expect(rendered).toContain('//bind ""')
    expect(rendered).toContain('[q2l cid=movement:crouch]')
  })

  it('carries the entry\'s own aliasName as `an`, since no alias line exists to spell it out', () => {
    const action: ConfigAction = {
      id: 'a4',
      categoryId: 'movement',
      name: 'Custom hop',
      kind: 'bind',
      aliasName: '+hop',
      commands: [],
    }
    const profile = baseProfile('fixture-unbound-aliasname', { actions: [action] })

    const rendered = renderProfileFile(profile)
    expect(rendered).toContain('an=+hop')
  })

  it('an alias/toggle/press-release entry never gets a second, unbound trace even when unreferenced', () => {
    const aliasAction: ConfigAction = {
      id: 'a5',
      categoryId: 'weapons',
      name: '+unused',
      kind: 'alias',
      commands: [{ kind: 'raw', text: '+attack' }],
    }
    const toggleAction: ConfigAction = {
      id: 'a6',
      categoryId: 'movement',
      name: 'Zoom',
      kind: 'toggle',
      commands: [],
      parts: [
        { commands: [{ kind: 'raw', text: 'fov 90' }] },
        { commands: [{ kind: 'raw', text: 'fov 120' }] },
      ],
    }
    const profile = baseProfile('fixture-two-part', { actions: [aliasAction, toggleAction] })

    const rendered = renderProfileFile(profile)
    expect(rendered).not.toContain('Entries:')
    expect(rendered).not.toContain('//bind')
  })
})

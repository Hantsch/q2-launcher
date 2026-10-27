// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignProfileInput, AssignProfileResult } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { profileFixture } from './test/fixtures'

// `lib/bridge.ts` resolves `window.q2` at module scope, so the stub must exist before the surfaces
// are imported.
const bridge = vi.hoisted(() => {
  const stub = { invoke: vi.fn(), on: () => () => {} }
  ;(globalThis as unknown as { q2: unknown }).q2 = stub
  return stub
})

const { ProfileAssignmentsPanel } = await import('./ProfileAssignmentsPanel')
const { ProfileDraftProvider } = await import('./lib/ProfileDraftProvider')
const { useConfigProfiles } = await import('./config-profiles-store')
const { Toasts } = await import('../../components/ui/Toasts')
const { useLauncher } = await import('../../store/useLauncher')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const profile = profileFixture({ id: 'p1' })
const assigned = (installationId: string) => ({
  ...profile,
  assignments: [{ installationId, isDefault: true }],
})

let container: HTMLDivElement
let root: Root
let assignCalls: AssignProfileInput[]

/** Answers `foreignFile` for installation `a` until it is called with consent. */
function answerAssign(): void {
  bridge.invoke.mockImplementation(
    async (_channel: string, request: { payload: AssignProfileInput }) => {
      assignCalls.push(request.payload)
      const { installationId, overwriteForeign } = request.payload
      const value: AssignProfileResult =
        installationId === 'a' && !overwriteForeign
          ? { status: 'foreignFile', fileName: 'My-Config.cfg', installationId }
          : { status: 'assigned', profiles: [assigned(installationId)] }
      return { ok: true, value }
    },
  )
}

const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]')
const byTestId = (id: string): HTMLButtonElement | null =>
  document.querySelector(`[data-testid="${id}"]`)

async function tick(name: string): Promise<void> {
  const row = [...container.querySelectorAll('li')].find((li) => li.textContent?.includes(name))
  const box = row?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!box) throw new Error(`no checkbox for ${name}`)
  await act(async () => box.click())
}

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  assignCalls = []
  answerAssign()
  useConfigProfiles.setState({ profiles: [profile] })
  useLauncher.setState({
    toasts: [],
    installations: [
      { id: 'a', name: 'Install A', engineKind: 'r1q2' },
      { id: 'b', name: 'Install B', engineKind: 'r1q2' },
    ] as never,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <>
        <ProfileDraftProvider profile={profile}>
          <ProfileAssignmentsPanel />
        </ProfileDraftProvider>
        <Toasts />
      </>,
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  bridge.invoke.mockReset()
})

describe('assigning over a foreign config file', () => {
  it('a foreign file answer opens the dialog instead of a toast', async () => {
    await tick('Install B')
    expect(dialog()).toBeNull()
    expect(useConfigProfiles.getState().profiles[0].assignments).toHaveLength(1)

    await tick('Install A')

    expect(dialog()?.textContent).toContain('A config named My-Config.cfg already exists')
    expect(dialog()?.textContent).toContain('“Install A”')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.body.textContent).not.toContain("Could not write this profile's files")
    expect(
      useConfigProfiles.getState().profiles[0].assignments.map((a) => a.installationId),
    ).toEqual(['b'])

    await act(async () => byTestId('foreign-config-cancel')?.click())
    expect(dialog()).toBeNull()
    expect(assignCalls.filter((call) => call.overwriteForeign)).toHaveLength(0)
  })

  it('Write re-sends with overwriteForeign', async () => {
    await tick('Install A')
    await act(async () => byTestId('foreign-config-write')?.click())

    expect(assignCalls).toEqual([
      { profileId: 'p1', installationId: 'a' },
      { profileId: 'p1', installationId: 'a', overwriteForeign: true },
    ])
    expect(dialog()).toBeNull()
    expect(useConfigProfiles.getState().profiles[0].assignments[0].installationId).toBe('a')
  })
})

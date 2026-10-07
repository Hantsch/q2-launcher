// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyAutorecord } from '@shared/config/catalog/autorecord'
import type { EngineKind } from '@shared/types/engine'
import { initI18n } from '../../../i18n'
import type { EngineScopeStatus } from '../lib/engine-scope'
import { AutorecordSetting } from './AutorecordSetting'

// Mirrors `ProfileChangeList.test.tsx`: real react-dom mount under `act`, `initI18n('en')` once.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(
  engine: EngineKind | null,
  scopeStatus: EngineScopeStatus,
  cvars: Record<string, string> = {},
  onChange: (next: Record<string, string>) => void = () => {},
): void {
  act(() => {
    root.render(
      <AutorecordSetting
        cvars={cvars}
        engine={engine}
        scopeStatus={scopeStatus}
        onChange={onChange}
      />,
    )
  })
}

const byId = (id: string): HTMLElement | null => container.querySelector(`[data-testid="${id}"]`)

describe('AutorecordSetting', () => {
  it('vanilla shows the switch disabled with its reason as visible text', () => {
    render('yquake2', 'ok')
    const sw = byId('config-autorecord-switch') as HTMLButtonElement
    expect(sw.disabled).toBe(true)
    expect(byId('config-autorecord-reason')?.textContent).toBe(
      'Not available on Yamagi Quake II: it has no way to record every map automatically.',
    )
    expect(byId('config-autorecord-caveat')).toBeNull()
  })

  it('no engine in scope shows the switch disabled with its reason', () => {
    render(null, 'unassigned')
    expect((byId('config-autorecord-switch') as HTMLButtonElement).disabled).toBe(true)
    expect(byId('config-autorecord-reason')?.textContent).toContain('r1q2 or Q2PRO')
  })

  it('r1q2 shows the same-minute overwrite caveat', () => {
    render('r1q2', 'ok')
    expect((byId('config-autorecord-switch') as HTMLButtonElement).disabled).toBe(false)
    expect(byId('config-autorecord-caveat')?.textContent).toContain('within one minute')
    expect(byId('config-autorecord-reason')).toBeNull()
  })

  it('q2pro shows the console clock caveat', () => {
    render('q2pro', 'ok')
    const text = byId('config-autorecord-caveat')?.textContent ?? ''
    expect(text).toContain('console clock')
    expect(text).toContain('$com_time')
    expect(text).toContain('cl_beginmapcmd')
  })

  it("toggling calls onChange with applyAutorecord's map", () => {
    const calls: Record<string, string>[] = []
    const cvars = { cl_beginmapcmd: 'echo hi', name: 'x' }
    render('q2pro', 'ok', cvars, (next) => calls.push(next))
    act(() => {
      byId('config-autorecord-switch')?.click()
    })
    expect(calls).toEqual([applyAutorecord(cvars, 'q2pro', true)])
    expect(calls[0]?.['com_time_format']).toBe('%H-%M-%S')
  })
})

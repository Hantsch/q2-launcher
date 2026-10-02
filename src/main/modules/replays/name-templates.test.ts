import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPLAYS_HANDLERS } from '@shared/modules/replays'
import { nameTemplatesFingerprint, type NameTemplatesView } from '@shared/replays/name-templates'
import { fakeAppContext } from '../../../test-support/app-context'
import { StateStore } from '../../services/state'
import { MainModuleRegistry } from '../registry'
import { replaysModule } from './index'

/**
 * Story 144 D3 made module setup construct a `ReplaysIndexCache`, which resolves its file path
 * through `userDataDir()` (`electron.app.getPath('userData')`) - mocked the same way
 * `index.test.ts` and `index-cache.test.ts` do, a per-test temp folder standing in for userData.
 */
const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

/**
 * Story 140 D2: the `nameTemplates.*` handlers' round trip - a real `StateStore` over a temp file,
 * driven through the real registry (so the shared payload schemas run too), then reloaded from disk
 * via a second, independent `StateStore` - the only way to prove a mutation both persisted and
 * survived `parseReplaysState`. Mirrors `src/main/modules/servers/index.test.ts`'s `sources.*` block.
 */
type NameTemplatesOutcome =
  | { ok: true; value: NameTemplatesView }
  | { ok: false; error: { key: string; params?: Record<string, unknown> } }

describe('replays module nameTemplates.* handlers (story 140 D2)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry
  let userDataDirPath: string

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-name-templates-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
    userDataDirPath = await mkdtemp(join(tmpdir(), 'q2-launcher-name-templates-userdata-'))
    userDataBox.current = userDataDirPath
    registry = new MainModuleRegistry()
    await registry.register(replaysModule, fakeAppContext({ state }))
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
    await rm(userDataDirPath, { recursive: true, force: true })
  })

  /** The registry passes each handler's own `Outcome<T>` through unchanged. */
  async function invoke(type: string, payload?: unknown): Promise<NameTemplatesOutcome> {
    return (await registry.invoke({ moduleId: 'replays', type, payload })) as NameTemplatesOutcome
  }

  async function listIds(): Promise<string[]> {
    const result = await invoke(REPLAYS_HANDLERS.nameTemplatesList)
    if (!result.ok) throw new Error('expected nameTemplates.list to succeed')
    return result.value.entries.map((entry) => entry.id)
  }

  it('name templates survive a state reload', async () => {
    const added = await invoke(REPLAYS_HANDLERS.nameTemplatesAdd, { template: '{map}_{date}' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const beforeIds = added.value.entries.map((entry) => entry.id)
    const beforeTemplates = added.value.entries.map((entry) => entry.template)

    await state.settle()
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    const reloadedRegistry = new MainModuleRegistry()
    await reloadedRegistry.register(replaysModule, fakeAppContext({ state: reloaded }))

    const outcome = await reloadedRegistry.invoke({
      moduleId: 'replays',
      type: REPLAYS_HANDLERS.nameTemplatesList,
      payload: undefined,
    })
    const result = outcome as NameTemplatesOutcome
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entries.map((entry) => entry.id)).toEqual(beforeIds)
    expect(result.value.entries.map((entry) => entry.template)).toEqual(beforeTemplates)
  })

  it("an invalid template is rejected with the validator's reason and not stored", async () => {
    const before = await listIds()

    const unclosed = await invoke(REPLAYS_HANDLERS.nameTemplatesAdd, { template: '{map' })
    expect(unclosed).toEqual({
      ok: false,
      error: { key: 'replays.nameTemplate.error.unclosedBrace', params: { position: 0 } },
    })

    const unknownToken = await invoke(REPLAYS_HANDLERS.nameTemplatesAdd, { template: '{bogus}' })
    expect(unknownToken).toEqual({
      ok: false,
      error: { key: 'replays.nameTemplate.error.unknownToken', params: { token: 'bogus' } },
    })

    expect(await listIds()).toEqual(before)
  })

  it('a payload over the length cap or with a non-printable character is rejected at the seam', async () => {
    const beforeState = state.replaysState()

    const tooLong = await registry.invoke({
      moduleId: 'replays',
      type: REPLAYS_HANDLERS.nameTemplatesAdd,
      payload: { template: '{map}'.padEnd(200, 'x') },
    })
    expect(tooLong).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })

    const nonPrintable = await registry.invoke({
      moduleId: 'replays',
      type: REPLAYS_HANDLERS.nameTemplatesAdd,
      payload: { template: '{map}\u0007' },
    })
    expect(nonPrintable).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })

    expect(state.replaysState()).toEqual(beforeState)
  })

  it('reorder, remove, reset and restore persist', async () => {
    const first = await invoke(REPLAYS_HANDLERS.nameTemplatesAdd, { template: '{map}_{date}' })
    const second = await invoke(REPLAYS_HANDLERS.nameTemplatesAdd, { template: '{host}-{map}' })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    // The persisted list is already reconciled with the shipped patterns (each `add` above merges
    // and persists the full state), so `second.value.entries` holds both shipped and user rows -
    // reorder/remove operate over the *whole* list, not just the two just-added user entries.
    const ids = second.value.entries.map((entry) => entry.id)
    expect(ids.length).toBeGreaterThan(2)
    const reversed = [...ids].reverse()

    const reordered = await invoke(REPLAYS_HANDLERS.nameTemplatesReorder, { ids: reversed })
    expect(reordered.ok).toBe(true)
    if (!reordered.ok) return
    expect(reordered.value.entries.map((entry) => entry.id)).toEqual(reversed)

    const removeId = reversed[0]!
    const removed = await invoke(REPLAYS_HANDLERS.nameTemplatesRemove, { id: removeId })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.value.entries.map((entry) => entry.id)).toEqual(reversed.slice(1))

    // Reset/restore on a shipped entry.
    const shipped = removed.value.entries.find((entry) => entry.origin === 'shipped')
    expect(shipped).toBeDefined()
    if (shipped === undefined) return

    const updated = await invoke(REPLAYS_HANDLERS.nameTemplatesUpdate, {
      id: shipped.id,
      template: '{map}-{date}-{time}.dm2',
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value.entries.find((entry) => entry.id === shipped.id)?.edited).toBe(true)

    const reset = await invoke(REPLAYS_HANDLERS.nameTemplatesReset, { id: shipped.id })
    expect(reset.ok).toBe(true)
    if (!reset.ok) return
    expect(reset.value.entries.find((entry) => entry.id === shipped.id)?.edited).toBe(false)

    const removedShipped = await invoke(REPLAYS_HANDLERS.nameTemplatesRemove, { id: shipped.id })
    expect(removedShipped.ok).toBe(true)
    if (!removedShipped.ok) return
    expect(removedShipped.value.canRestore).toBe(true)
    expect(removedShipped.value.entries.some((entry) => entry.id === shipped.id)).toBe(false)

    const restored = await invoke(REPLAYS_HANDLERS.nameTemplatesRestore)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.value.canRestore).toBe(false)
    expect(restored.value.entries.some((entry) => entry.id === shipped.id)).toBe(true)

    // Persisted, not just in-memory.
    await state.settle()
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(reloaded.replaysState().nameTemplates.removedShippedIds).toEqual([])
  })

  it("an unknown id on update/remove/reset returns 'notFound'", async () => {
    const update = await invoke(REPLAYS_HANDLERS.nameTemplatesUpdate, {
      id: 'nope',
      template: '{map}',
    })
    expect(update).toEqual({ ok: false, error: { key: 'replays.nameTemplates.error.notFound' } })

    const remove = await invoke(REPLAYS_HANDLERS.nameTemplatesRemove, { id: 'nope' })
    expect(remove).toEqual({ ok: false, error: { key: 'replays.nameTemplates.error.notFound' } })

    const reset = await invoke(REPLAYS_HANDLERS.nameTemplatesReset, { id: 'nope' })
    expect(reset).toEqual({ ok: false, error: { key: 'replays.nameTemplates.error.notFound' } })
  })

  it("the effective templates' fingerprint changes after each mutation", async () => {
    // Compares each step's fingerprint to the one immediately before it, not to every fingerprint
    // seen so far: removing the one template `add` introduced legitimately returns the list to its
    // pre-`add` shape, so its fingerprint equals the very first one again - that is correct, not a
    // failure to change on *its own* step.
    const fingerprintOf = (view: NameTemplatesView): string =>
      nameTemplatesFingerprint(view.entries.map((entry) => entry.template))

    const list = await invoke(REPLAYS_HANDLERS.nameTemplatesList)
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const beforeAdd = fingerprintOf(list.value)

    const added = await invoke(REPLAYS_HANDLERS.nameTemplatesAdd, { template: '{map}_{date}' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const afterAdd = fingerprintOf(added.value)
    expect(afterAdd).not.toBe(beforeAdd)

    const id = added.value.entries[added.value.entries.length - 1]!.id
    const updated = await invoke(REPLAYS_HANDLERS.nameTemplatesUpdate, {
      id,
      template: '{map}_{date}_{time}',
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    const afterUpdate = fingerprintOf(updated.value)
    expect(afterUpdate).not.toBe(afterAdd)

    const removed = await invoke(REPLAYS_HANDLERS.nameTemplatesRemove, { id })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    const afterRemove = fingerprintOf(removed.value)
    expect(afterRemove).not.toBe(afterUpdate)
    expect(afterRemove).toBe(beforeAdd)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SERVERS_STATE, type ScanTarget } from '@shared/modules/servers'
import { runScan } from './scan-runner'
import {
  bindResponder,
  buildProfiles,
  closeResponders,
  type Responder,
} from './scan-fixture-responders'

const POPULATION_SIZE = 30

describe('scan runner over loopback responders', () => {
  let responders: Responder[]

  beforeAll(async () => {
    responders = await Promise.all(buildProfiles(POPULATION_SIZE).map(bindResponder))
  })

  afterAll(async () => {
    await closeResponders(responders)
  })

  it('a full two-stage pass over the loopback population answers every live server and queries status only for non-empty ones', async () => {
    const settings = DEFAULT_SERVERS_STATE.scan
    const targets: ScanTarget[] = responders.map((responder) => ({
      address: responder.address,
      origins: [],
    }))
    let stage1Ok = 0
    let stage2Ok = 0

    const result = await runScan({
      targets,
      settings,
      onServer: (row) => {
        if (!row.result.ok) return
        if (row.stage === 'stage1') stage1Ok += 1
        else stage2Ok += 1
      },
    })

    const answering = responders.filter(
      ({ profile }) => !profile.dead && (!profile.lossy || settings.retries >= 1),
    )
    const nonEmpty = answering.filter(({ profile }) => profile.clients > 0)
    expect(result.aborted).toBe(false)
    expect(result.stage1Done).toBe(POPULATION_SIZE)
    expect(stage1Ok).toBe(answering.length)
    expect(result.stage2Total).toBe(nonEmpty.length)
    expect(stage2Ok).toBe(nonEmpty.length)
    for (const responder of responders) {
      expect(responder.received.info).toBeGreaterThanOrEqual(1)
      expect(responder.received.status > 0).toBe(nonEmpty.includes(responder))
    }
  }, 30_000)
})

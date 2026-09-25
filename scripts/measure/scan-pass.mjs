/**
 * Story 115 D6: `npm run measure:scan` - the measurement the shipped scan defaults are taken from.
 *
 * What it measures: story 114's REAL two-stage scheduler (`runScan` in
 * `src/main/modules/servers/scan-runner.ts`, with its default, real `queryServer` - one real
 * `node:dgram` socket per query) sweeping a population of fake Quake II servers bound on
 * `127.0.0.1`. Nothing here re-implements the pool, the staging or the query state machine, and
 * nothing parses fixture bytes without a socket round-trip: every reply is a real datagram sent by
 * a real responder socket after that responder's own seeded delay.
 *
 * Why this file launches itself through vitest: `runScan` and everything it imports are TypeScript
 * behind the `@shared`/`@main` aliases, and plain Node in this repo has no loader for either. The
 * one TS-execution path already wired in is vitest, so this file has two modes:
 * - run with plain `node` (what `npm run measure:scan` does), it starts vitest through its node API
 *   over this very file - with `include` narrowed to it, so `npm test`'s own `include` never picks
 *   the multi-minute measurement up;
 * - run inside that vitest worker (`process.env.VITEST` is set), it is the measurement itself, as
 *   one long `it(...)` that prints its report to stdout.
 *
 * GB-A5: every socket this file binds is on `127.0.0.1`; no hostname is resolved, no real master
 * or game server is ever contacted.
 *
 * Env knobs (optional): `MEASURE_REPS` (repetitions per modelled configuration, default 3),
 * `MEASURE_ZERO_REPS` (repetitions per zero-delay configuration, default 10), `MEASURE_QUICK=1`
 * (a tiny matrix, only for checking the harness itself - never for numbers that get recorded).
 */

import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(SELF), '..', '..')
const MEASUREMENT_TIMEOUT_MS = 60 * 60 * 1000

if (process.env.VITEST === undefined) {
  await launchUnderVitest()
} else {
  await defineMeasurement()
}

/** Plain-node mode: run this file as the one and only vitest test file. */
async function launchUnderVitest() {
  const { startVitest } = await import('vitest/node')
  const vitest = await startVitest('test', [SELF], {
    root: REPO_ROOT,
    include: ['scripts/measure/scan-pass.mjs'],
    run: true,
    watch: false,
    testTimeout: MEASUREMENT_TIMEOUT_MS,
    // The report is the script's whole purpose - let it reach stdout as it is written.
    disableConsoleIntercept: true,
  })
  const failed = vitest?.state.getCountOfFailedTests() ?? 1
  await vitest?.close()
  if (failed > 0 || vitest === undefined) process.exitCode = 1
}

/** Vitest-worker mode: the measurement itself. */
async function defineMeasurement() {
  const { it, expect } = await import('vitest')
  const { createSocket } = await import('node:dgram')
  const os = await import('node:os')
  const { readFileSync } = await import('node:fs')
  const { runScan } = await import('@main/modules/servers/scan-runner')
  const { buildInfoReplyBytes, buildStatusReplyBytes } = await import('@shared/servers/reply-fixtures')

  // --- The modelled population (an invented input, recorded as such in story 115) -------------

  const SEED = 0x115
  /** Share of the population bound but never answering anything (a server that is down). */
  const DEAD_SHARE = 0.15
  /** Share of the *live* population that drops the first datagram of each query kind per pass (one
   * lost packet) - answers only a retry. Makes the `retries` knob's benefit visible on loopback. */
  const LOSSY_SHARE = 0.05
  /** Share of the *live* population reporting `clients > 0` (the stage-2 targets). */
  const NON_EMPTY_SHARE = 0.4
  /** Per-responder reply delay: a three-bucket mixture, uniform inside each bucket, drawn once. */
  const DELAY_BUCKETS = [
    { share: 0.7, minMs: 5, maxMs: 30 },
    { share: 0.25, minMs: 30, maxMs: 150 },
    { share: 0.05, minMs: 150, maxMs: 400 },
  ]

  const QUICK = process.env.MEASURE_QUICK === '1'
  const REPS = Number(process.env.MEASURE_REPS ?? (QUICK ? 1 : 3))
  const ZERO_REPS = Number(process.env.MEASURE_ZERO_REPS ?? (QUICK ? 2 : 10))
  const POPULATION_SIZES = QUICK ? [30] : [100, 200, 300]
  const LARGEST = Math.max(...POPULATION_SIZES)

  /**
   * The matrix: a representative subset of D1's choice lists, not every combination - a full cross
   * at three population sizes would run for the better part of an hour, because every dead server
   * costs `timeoutMs * (retries + 1)` of one pool slot per pass. Concurrency is swept widest at
   * N=300 (the concept's upper bound); the 2000 ms timeout is sampled at one concurrency, which is
   * enough to show what the timeout alone costs; N=100/200 show how the pass scales with size.
   */
  function modelledConfigsFor(n) {
    if (QUICK) return [{ concurrency: 16, timeoutMs: 500, retries: 1 }]
    const grid = (concurrencies, timeoutMs) =>
      [0, 1].flatMap((retries) => concurrencies.map((concurrency) => ({ concurrency, timeoutMs, retries })))
    if (n === 100) return grid([8, 16, 24], 1000)
    if (n === 200) return grid([16, 24], 1000)
    return [...grid([8, 16, 24, 32], 1000), ...grid([24], 2000)]
  }
  const ZERO_DELAY_CONCURRENCIES = QUICK ? [16] : [8, 32]

  /** mulberry32 - tiny deterministic PRNG, so the population is identical on every run. */
  function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** Draws every profile in sequence with a fixed number of draws per responder, so the population
   * of size 100 is exactly the first 100 of the population of size 300. */
  function buildProfiles(count) {
    const rand = mulberry32(SEED)
    const profiles = []
    for (let i = 0; i < count; i++) {
      const deadU = rand()
      const lossyU = rand()
      const clientsU = rand()
      const bucketU = rand()
      const delayU = rand()
      const dead = deadU < DEAD_SHARE
      const lossy = !dead && lossyU < LOSSY_SHARE
      const clients = clientsU < NON_EMPTY_SHARE ? 1 + Math.floor((clientsU / NON_EMPTY_SHARE) * 7) : 0
      let acc = 0
      let bucket = DELAY_BUCKETS[DELAY_BUCKETS.length - 1]
      for (const candidate of DELAY_BUCKETS) {
        acc += candidate.share
        if (bucketU < acc) {
          bucket = candidate
          break
        }
      }
      const delayMs = Math.round(bucket.minMs + delayU * (bucket.maxMs - bucket.minMs))
      profiles.push({ index: i, dead, lossy, clients, delayMs, hostname: `Measure Server ${i}` })
    }
    return profiles
  }

  // --- The responders (real sockets, 127.0.0.1 only) --------------------------------------------

  /** Same classification as `scan-integration.test.ts`: the token right after the OOB prefix. */
  function decodeQueryKind(message) {
    const text = message.subarray(4).toString('latin1')
    if (text.startsWith('info')) return 'info'
    if (text.startsWith('status')) return 'status'
    return 'unknown'
  }

  /** `zeroDelay`: every responder answers at once, nobody is dead or lossy - the scheduler's own cost. */
  const mode = { zeroDelay: false }

  async function bindResponder(profile) {
    const socket = createSocket('udp4')
    await new Promise((done) => socket.bind(0, '127.0.0.1', done))
    const port = socket.address().port
    const line =
      `\\gamename\\baseq2\\hostname\\${profile.hostname}\\mapname\\q2dm${(profile.index % 8) + 1}` +
      `\\clients\\${profile.clients}\\maxclients\\16\\version\\3.20`
    const playerLines = Array.from({ length: profile.clients }, (_, k) => `${k * 3} ${20 + k} "Player${k}"`)
    const responder = {
      profile,
      socket,
      address: `127.0.0.1:${port}`,
      infoBytes: buildInfoReplyBytes(line),
      statusBytes: buildStatusReplyBytes(line, playerLines),
      received: { info: 0, status: 0 },
      dropped: { info: false, status: false },
      sendErrors: 0,
    }
    socket.on('error', () => {
      responder.sendErrors += 1
    })
    socket.on('message', (message, rinfo) => {
      const kind = decodeQueryKind(message)
      if (kind === 'unknown') return
      responder.received[kind] += 1
      const bytes = kind === 'info' ? responder.infoBytes : responder.statusBytes
      if (mode.zeroDelay) {
        socket.send(bytes, rinfo.port, rinfo.address)
        return
      }
      if (profile.dead) return
      if (profile.lossy && !responder.dropped[kind]) {
        responder.dropped[kind] = true
        return
      }
      setTimeout(() => socket.send(bytes, rinfo.port, rinfo.address), profile.delayMs)
    })
    return responder
  }

  function resetResponders(responders) {
    for (const responder of responders) {
      responder.received = { info: 0, status: 0 }
      responder.dropped = { info: false, status: false }
    }
  }

  // --- One pass through the real scheduler ------------------------------------------------------

  async function runPass(responders, settings) {
    resetResponders(responders)
    const byAddress = new Map(responders.map((responder) => [responder.address, responder]))
    const targets = responders.map((responder) => ({ address: responder.address, origins: [] }))
    const rows = { stage1Ok: 0, stage1Failed: 0, stage2Ok: 0, stage2Failed: 0, wrongHost: 0 }
    let stage2StartedAt = null

    const startedAt = performance.now()
    const result = await runScan({
      targets,
      settings,
      onServer: (row) => {
        const responder = byAddress.get(row.target.address)
        const key = row.stage === 'stage1' ? 'stage1' : 'stage2'
        if (!row.result.ok) {
          rows[`${key}Failed`] += 1
          return
        }
        rows[`${key}Ok`] += 1
        // Proves the row came off this responder's own datagram, parsed by the real parser.
        const hostname =
          row.result.kind === 'info' ? row.result.reply.hostname : row.result.reply.serverinfo.hostname
        if (responder === undefined || hostname !== responder.profile.hostname) rows.wrongHost += 1
      },
      onProgress: (progress) => {
        if (progress.phase === 'stage2' && stage2StartedAt === null) stage2StartedAt = performance.now()
      },
    })
    const endedAt = performance.now()

    checkIntegrity(responders, settings, result, rows)
    return {
      stage1Ms: stage2StartedAt - startedAt,
      stage2Ms: endedAt - stage2StartedAt,
      fullMs: endedAt - startedAt,
      stage2Total: result.stage2Total,
      online: rows.stage1Ok,
    }
  }

  /** Throws unless the pass really went over the wire the way story 114 specifies - a harness that
   * measured something other than a real two-stage pass fails here instead of printing numbers. */
  function checkIntegrity(responders, settings, result, rows) {
    const fail = (message) => {
      throw new Error(`integrity check failed: ${message}`)
    }
    const n = responders.length
    if (result.aborted) fail('the pass was aborted')
    if (result.stage1Total !== n || result.stage1Done !== n) fail(`stage 1 settled ${result.stage1Done}/${n}`)
    if (rows.wrongHost !== 0) fail(`${rows.wrongHost} rows did not carry their responder's hostname`)

    let expectedOnline = 0
    let expectedStage2 = 0
    for (const { profile, received } of responders) {
      const answers = mode.zeroDelay || (!profile.dead && (!profile.lossy || settings.retries >= 1))
      if (answers) expectedOnline += 1
      const nonEmpty = answers && profile.clients > 0
      if (nonEmpty) expectedStage2 += 1
      if (received.info < 1) fail(`responder ${profile.index} never received an info query`)
      if (!mode.zeroDelay && profile.dead && received.info !== settings.retries + 1) {
        fail(`dead responder ${profile.index} saw ${received.info} info sends, expected ${settings.retries + 1}`)
      }
      if (!nonEmpty && received.status !== 0) fail(`responder ${profile.index} was asked for status`)
      if (nonEmpty && received.status < 1) fail(`non-empty responder ${profile.index} got no status query`)
    }
    if (rows.stage1Ok !== expectedOnline) fail(`stage 1 online ${rows.stage1Ok}, expected ${expectedOnline}`)
    if (result.stage2Total !== expectedStage2) fail(`stage 2 total ${result.stage2Total}, expected ${expectedStage2}`)
    if (rows.stage2Ok !== expectedStage2 || rows.stage2Failed !== 0) {
      fail(`stage 2 ok ${rows.stage2Ok}/${expectedStage2}, failed ${rows.stage2Failed}`)
    }
  }

  // --- Statistics and report -------------------------------------------------------------------

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  /** Nearest-rank p95 - with a handful of repetitions this is the slowest one. */
  function p95(values) {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]
  }
  const ms = (value) => (value >= 100 ? value.toFixed(0) : value.toFixed(1))

  function environmentLines() {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'))
    const cpus = os.cpus()
    return [
      `- OS: ${os.platform()} ${os.release()} (${os.arch()})`,
      `- CPU: ${cpus[0]?.model?.trim() ?? 'unknown'} - ${cpus.length} logical cores`,
      `- Node: ${process.version} (via vitest; not an Electron main process)`,
      `- Repo pins: electron ${pkg.devDependencies?.electron ?? '?'}, electron-vite ${pkg.devDependencies?.['electron-vite'] ?? '?'}, vitest ${pkg.devDependencies?.vitest ?? '?'}`,
    ]
  }

  function populationLine(profiles) {
    const dead = profiles.filter((p) => p.dead).length
    const live = profiles.length - dead
    const lossy = profiles.filter((p) => p.lossy).length
    const nonEmptyLive = profiles.filter((p) => !p.dead && p.clients > 0).length
    const delays = profiles.filter((p) => !p.dead).map((p) => p.delayMs)
    return (
      `N=${profiles.length}: ${dead} dead, ${live} live (${lossy} lossy, ${nonEmptyLive} non-empty); ` +
      `live delay median ${median(delays)} ms, p95 ${p95(delays)} ms, max ${Math.max(...delays)} ms`
    )
  }

  it(
    'measures full two-stage passes of the real scheduler over a loopback population',
    async () => {
      const allProfiles = buildProfiles(LARGEST)
      const responders = []
      for (const profile of allProfiles) responders.push(await bindResponder(profile))
      const log = (line = '') => console.log(line)
      const tableRows = []
      const wallStartedAt = performance.now()
      try {
        log('')
        log('## scan-pass measurement (story 115 D6)')
        log('')
        for (const line of environmentLines()) log(line)
        log(`- Seed ${SEED}, reps per modelled config ${REPS}, reps per zero-delay config ${ZERO_REPS}`)
        log('')
        log('Population (prefixes of one seeded draw):')
        for (const n of POPULATION_SIZES) log(`- ${populationLine(allProfiles.slice(0, n))}`)
        log('')

        // Warm-up (discarded): JIT, lazy `node:dgram` import inside `queryServer`, socket paths.
        mode.zeroDelay = true
        await runPass(responders.slice(0, POPULATION_SIZES[0]), { concurrency: 16, timeoutMs: 1000, retries: 1 })

        const measure = async (population, settings, zeroDelay, reps) => {
          mode.zeroDelay = zeroDelay
          const samples = []
          for (let rep = 0; rep < reps; rep++) samples.push(await runPass(population, settings))
          const row = {
            n: population.length,
            zeroDelay,
            ...settings,
            stage1: samples.map((s) => s.stage1Ms),
            stage2: samples.map((s) => s.stage2Ms),
            full: samples.map((s) => s.fullMs),
            stage2Total: samples[0].stage2Total,
            online: samples[0].online,
            reps,
          }
          tableRows.push(row)
          log(
            `measured N=${row.n} ${zeroDelay ? 'zero-delay' : 'modelled'} c=${settings.concurrency} ` +
              `t=${settings.timeoutMs} r=${settings.retries}: full median ${ms(median(row.full))} ms ` +
              `(p95 ${ms(p95(row.full))} ms) over ${reps} reps`,
          )
        }

        for (const n of POPULATION_SIZES) {
          const population = responders.slice(0, n)
          for (const concurrency of ZERO_DELAY_CONCURRENCIES) {
            await measure(population, { concurrency, timeoutMs: 1000, retries: 1 }, true, ZERO_REPS)
          }
          for (const settings of modelledConfigsFor(n)) await measure(population, settings, false, REPS)
        }

        log('')
        log(
          '| N | delays | concurrency | timeoutMs | retries | stage 1 median / p95 (ms) | ' +
            'stage 2 median / p95 (ms) | full pass median / p95 (ms) | online | stage-2 targets | reps |',
        )
        log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
        for (const row of tableRows) {
          log(
            `| ${row.n} | ${row.zeroDelay ? 'zero' : 'modelled'} | ${row.concurrency} | ` +
              `${row.zeroDelay ? '-' : row.timeoutMs} | ${row.zeroDelay ? '-' : row.retries} | ` +
              `${ms(median(row.stage1))} / ${ms(p95(row.stage1))} | ` +
              `${ms(median(row.stage2))} / ${ms(p95(row.stage2))} | ` +
              `${ms(median(row.full))} / ${ms(p95(row.full))} | ${row.online}/${row.n} | ${row.stage2Total} | ${row.reps} |`,
          )
        }
        log('')
        log(`Total measurement wall time: ${((performance.now() - wallStartedAt) / 1000).toFixed(1)} s`)
        const sendErrors = responders.reduce((sum, r) => sum + r.sendErrors, 0)
        log(`Responder socket errors: ${sendErrors}`)
        log('')
      } finally {
        await Promise.all(responders.map((r) => new Promise((done) => r.socket.close(() => done()))))
      }
      expect(tableRows.length).toBeGreaterThan(0)
    },
    MEASUREMENT_TIMEOUT_MS,
  )
}

// Gate over a metrics file from engine:smoke: exit 0 iff the demo played (fps > 0) without a CSP
// violation, 1 naming the failing field otherwise. Run: node check.mjs [metrics.json]  (story 284)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('./results/metrics.json', import.meta.url))

let metrics
try {
  metrics = JSON.parse(readFileSync(file, 'utf8'))
} catch (error) {
  console.error(`check: cannot read ${file}: ${error.message}`)
  process.exit(1)
}

const failures = []
if (!(typeof metrics.fps === 'number' && metrics.fps > 0)) failures.push(`fps is ${metrics.fps}`)
if (metrics.cspViolations !== 0) failures.push(`cspViolations is ${metrics.cspViolations}`)
if (metrics.longTaskControlObserved !== true) failures.push('long-task control not observed')
if (!(metrics.playbackMotion >= 0.02)) failures.push(`playbackMotion is ${metrics.playbackMotion}`)

if (failures.length > 0) {
  console.error(`check FAILED (${file}): ${failures.join('; ')}`)
  process.exit(1)
}
console.log(`check OK (${file}): fps ${metrics.fps}, cspViolations 0`)

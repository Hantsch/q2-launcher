// Last step of every Linux job: Linux is not a supported platform, so its steps run with
// continue-on-error on GitHub and the job ends green; these warnings are the only signal a step
// failed. Always exits 0 so this step can never turn the job red itself.
import { pathToFileURL } from 'node:url'

/**
 * One `::warning::` line per step whose `outcome` is `failure`. `stepsJson` is the job's
 * `toJSON(steps)`: `{ <step id>: { outcome, conclusion, outputs } }`. `outcome`, not `conclusion`:
 * continue-on-error turns a failed step's conclusion into `success`.
 */
export function advisoryLines(check, stepsJson) {
  const steps = JSON.parse(stepsJson || '{}')
  return Object.entries(steps)
    .filter(([, step]) => step?.outcome === 'failure')
    .map(([id]) => `::warning::Linux check ${check} failed: ${id}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.env.CHECK || 'unknown'
  try {
    for (const line of advisoryLines(check, process.env.STEPS)) console.log(line)
  } catch (err) {
    console.log(`::warning::Linux check ${check} could not read its steps: ${err.message}`)
  }
  process.exitCode = 0
}

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flowTestIds, helperClosure, isTestFile } from './flow-select.mjs'
import { REPO_ROOT } from './paths.mjs'

const walk = (dir) =>
  readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  )
const read = (path) => readFileSync(join(REPO_ROOT, path), 'utf8')

/** The real tree, read once: flows with their derived testids, renderer sources, the area table. */
export function loadFlowTree() {
  const scriptPaths = [...walk('scripts/lib'), ...walk('scripts/flows')].filter((p) =>
    p.endsWith('.mjs'),
  )
  const scripts = new Map(scriptPaths.map((path) => [path, read(path)]))
  const flows = readdirSync(join(REPO_ROOT, 'scripts/flows'))
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => {
      const path = `scripts/flows/${file}`
      const helpers = helperClosure(path, scripts)
      const testIds = flowTestIds(
        scripts.get(path),
        helpers.map((helper) => scripts.get(helper)),
      )
      return { name: file.slice(0, -'.mjs'.length), path, helpers, testIds }
    })
  const srcFiles = walk('src').filter((path) => !isTestFile(path))
  const rendererFiles = srcFiles
    .filter((path) => path.startsWith('src/renderer/') && /\.tsx?$/.test(path))
    .map((path) => ({ path, source: read(path) }))
  const areas = JSON.parse(read('scripts/flows/areas.json'))
  return { scripts, flows, srcFiles, rendererFiles, areas }
}

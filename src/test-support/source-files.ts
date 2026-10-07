import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Every file under `dir`, recursively. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

import { MODULE_LOCALES_EN } from '../modules/locales'
import shell from './locales/en.shell.json'

type Tree = { [key: string]: Tree | string }

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Merges locale trees; two files defining the same leaf is a bug, not an override. */
export function deepMerge(...trees: readonly Tree[]): Tree {
  const out: Tree = {}
  const merge = (target: Tree, source: Tree, path: string): void => {
    for (const [key, value] of Object.entries(source)) {
      const here = path ? `${path}.${key}` : key
      const existing = target[key]
      if (existing === undefined) {
        target[key] = isTree(value) ? deepMerge(value) : value
      } else if (isTree(existing) && isTree(value)) {
        merge(existing, value, here)
      } else {
        throw new Error(`i18n key defined twice: ${here}`)
      }
    }
  }
  for (const tree of trees) merge(out, tree, '')
  return out
}

type Intersect<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never

/** The one import point for the English bundle: tests in main/shared read it here, never from the JSON files. */
export const en = deepMerge(shell, ...MODULE_LOCALES_EN) as typeof shell &
  Intersect<(typeof MODULE_LOCALES_EN)[number]>

/**
 * Demo folder navigation — pure. Builds the breadcrumb/folder/demo view of one level of the demo
 * tree from flat rows plus the discovered folder list, and validates new folder names.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC,
 * no electron.
 */

import { refuse, type DomainResult } from '../types/common'
import { endsWithDotOrSpace, firstInvalidChar, reservedNameIn } from './file-name-rules'

export const FOLDER_NAME_MAX = 100

export type FolderNameRefusalKey =
  | 'replays.folder.error.empty'
  | 'replays.folder.error.separator'
  | 'replays.folder.error.dotDot'
  | 'replays.folder.error.invalidChar'
  | 'replays.folder.error.trailingDotOrSpace'
  | 'replays.folder.error.reserved'
  | 'replays.folder.error.tooLong'

export type ValidateFolderNameResult = DomainResult<{ name: string }, FolderNameRefusalKey>

/** Checks run in a fixed order so the first violated rule is the one reported. */
export function validateFolderName(input: string): ValidateFolderNameResult {
  const name = input.trim()
  if (name.length === 0) return refuse('replays.folder.error.empty')
  if (name.includes('/') || name.includes('\\')) return refuse('replays.folder.error.separator')
  if (name === '.' || name === '..') return refuse('replays.folder.error.dotDot')
  const badChar = firstInvalidChar(name)
  if (badChar !== null) return refuse('replays.folder.error.invalidChar', { char: badChar })
  if (endsWithDotOrSpace(name)) return refuse('replays.folder.error.trailingDotOrSpace')
  const reserved = reservedNameIn(name)
  if (reserved !== null) return refuse('replays.folder.error.reserved', { name: reserved })
  if (name.length > FOLDER_NAME_MAX)
    return refuse('replays.folder.error.tooLong', { max: FOLDER_NAME_MAX })
  return { ok: true, name }
}

/** A folder inside a demo source; `path` is empty for the source's root. */
export type FolderRef = { sourceKey: string; path: string[] }

/** The minimal row shape the view needs; `source` is the human label of the row's root. */
export type FolderRow = { sourceKey: string; source?: string; folder: string[] }

export type DiscoveredFolder = {
  sourceKey: string
  source?: string
  path: string[]
  archive: boolean
}

/** `label` is `null` for the "All demos" crumb (`ref` null too): the renderer translates it. */
export type FolderCrumb = { label: string | null; ref: FolderRef | null }

export type FolderEntry = {
  ref: FolderRef
  name: string
  /** Set on root entries only: the source's display label. */
  label?: string
  archive: boolean
  demoCount: number
}

export type FolderView<R extends FolderRow> = {
  crumbs: FolderCrumb[]
  folders: FolderEntry[]
  demos: R[]
}

export function isPrefix(prefix: string[], path: string[]): boolean {
  return prefix.length <= path.length && prefix.every((seg, i) => seg === path[i])
}

export function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && isPrefix(a, b)
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

/** All rows at any depth below `current`; every root's rows when `current` is `null`. */
export function rowsBelow<R extends FolderRow>(rows: R[], current: FolderRef | null): R[] {
  if (current === null) return rows
  return rows.filter((r) => r.sourceKey === current.sourceKey && isPrefix(current.path, r.folder))
}

/** The deepest of `current` and its ancestors that still exists in `folders`, or `null`. */
export function nearestExisting(
  current: FolderRef | null,
  folders: Pick<DiscoveredFolder, 'sourceKey' | 'path'>[],
): FolderRef | null {
  if (current === null) return null
  for (let len = current.path.length; len >= 0; len--) {
    const path = current.path.slice(0, len)
    if (folders.some((f) => f.sourceKey === current.sourceKey && samePath(f.path, path))) {
      return { sourceKey: current.sourceKey, path }
    }
  }
  return null
}

/** Whether `current` is a zip pseudo-folder or lies inside one - those are read-only. */
export function isInArchive(
  current: FolderRef | null,
  folders: Pick<DiscoveredFolder, 'sourceKey' | 'path' | 'archive'>[],
): boolean {
  if (current === null) return false
  return folders.some(
    (f) => f.archive && f.sourceKey === current.sourceKey && isPrefix(f.path, current.path),
  )
}

export function buildFolderView<R extends FolderRow>(input: {
  rows: R[]
  folders: DiscoveredFolder[]
  current: FolderRef | null
}): FolderView<R> {
  const { rows, folders, current } = input

  const labels = new Map<string, string>()
  for (const item of [...folders, ...rows]) {
    if (item.source && !labels.has(item.sourceKey)) labels.set(item.sourceKey, item.source)
  }
  const labelOf = (sourceKey: string): string => labels.get(sourceKey) ?? sourceKey

  if (current === null) {
    const roots = new Map<string, FolderEntry>()
    const root = (sourceKey: string): FolderEntry => {
      let e = roots.get(sourceKey)
      if (!e) {
        e = {
          ref: { sourceKey, path: [] },
          name: labelOf(sourceKey),
          label: labelOf(sourceKey),
          archive: false,
          demoCount: 0,
        }
        roots.set(sourceKey, e)
      }
      return e
    }
    for (const f of folders) {
      const e = root(f.sourceKey)
      if (f.path.length === 0 && f.archive) e.archive = true
    }
    for (const r of rows) root(r.sourceKey).demoCount++
    return {
      crumbs: [{ label: null, ref: null }],
      folders: [...roots.values()].sort((a, b) => compareNames(a.name, b.name)),
      demos: [],
    }
  }

  const depth = current.path.length
  const children = new Map<string, FolderEntry>()
  const child = (name: string): FolderEntry => {
    let e = children.get(name)
    if (!e) {
      e = {
        ref: { sourceKey: current.sourceKey, path: [...current.path, name] },
        name,
        archive: false,
        demoCount: 0,
      }
      children.set(name, e)
    }
    return e
  }
  for (const f of folders) {
    if (f.sourceKey !== current.sourceKey || f.path.length <= depth) continue
    if (!isPrefix(current.path, f.path)) continue
    const e = child(f.path[depth])
    if (f.path.length === depth + 1 && f.archive) e.archive = true
  }
  const demos: R[] = []
  for (const r of rowsBelow(rows, current)) {
    if (r.folder.length === depth) demos.push(r)
    else child(r.folder[depth]).demoCount++
  }

  const crumbs: FolderCrumb[] = [
    { label: null, ref: null },
    { label: labelOf(current.sourceKey), ref: { sourceKey: current.sourceKey, path: [] } },
  ]
  current.path.forEach((seg, i) => {
    crumbs.push({
      label: seg,
      ref: { sourceKey: current.sourceKey, path: current.path.slice(0, i + 1) },
    })
  })

  return {
    crumbs,
    folders: [...children.values()].sort((a, b) => compareNames(a.name, b.name)),
    demos,
  }
}

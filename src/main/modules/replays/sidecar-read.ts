import {
  SIDECAR_SCHEMA_VERSION,
  sidecarFieldsSchema,
  type SidecarFields,
} from '@shared/replays/sidecar'
import type { SidecarIssue, SidecarState } from '@shared/modules/replays'

/**
 * Story 147: a broken or partially-invalid sidecar must never be dropped silently. This is the
 * pure reader - no filesystem, no clock - that turns raw bytes into whatever fields validate plus
 * a list of everything that didn't. A later deliverable wires this into the fs layer (and is where
 * `SidecarIssue.kind: 'unreadable'` gets produced, for a file that couldn't be read at all).
 */

/** Converts a 0-based JSON.parse error position into a 1-based line/column, or `undefined` if the
 * position can't be confidently extracted from the error message. */
function positionFromError(
  err: unknown,
  text: string,
): { line: number; column: number } | undefined {
  if (!(err instanceof Error)) return undefined
  const match = /position (\d+)/.exec(err.message)
  if (!match) return undefined
  const pos = Number(match[1])
  if (!Number.isFinite(pos) || pos < 0 || pos > text.length) return undefined

  let line = 1
  let lastNewline = -1
  for (let i = 0; i < pos; i++) {
    if (text[i] === '\n') {
      line++
      lastNewline = i
    }
  }
  const column = pos - lastNewline
  return { line, column }
}

/** Reads sidecar bytes defensively: never throws, never drops the whole file over one bad field.
 * `values` carries whatever fields validated; `state` names every problem found, if any. */
export function readSidecarDefensively(bytes: Buffer | string): {
  values: Partial<SidecarFields>
  state: SidecarState
} {
  let text = typeof bytes === 'string' ? bytes : bytes.toString('utf8')
  if (text.startsWith('﻿')) text = text.slice(1)

  if (text.trim() === '') {
    const issue: SidecarIssue = {
      kind: 'invalidJson',
      key: 'replays.sidecar.issue.invalidJson',
      params: {},
    }
    return { values: {}, state: { state: 'error', issues: [issue] } }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    const position = positionFromError(err, text)
    const params: Record<string, unknown> = position
      ? { line: position.line, column: position.column }
      : {}
    const issue: SidecarIssue = {
      kind: 'invalidJson',
      key: 'replays.sidecar.issue.invalidJson',
      params,
    }
    return { values: {}, state: { state: 'error', issues: [issue] } }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const issue: SidecarIssue = {
      kind: 'notAnObject',
      key: 'replays.sidecar.issue.notAnObject',
      params: {},
    }
    return { values: {}, state: { state: 'error', issues: [issue] } }
  }

  const obj = parsed as Record<string, unknown>
  const issues: SidecarIssue[] = []
  const values: Partial<SidecarFields> = {}

  const hasVersion = Object.prototype.hasOwnProperty.call(obj, 'schemaVersion')
  const rawVersion = obj.schemaVersion
  const versionOk =
    hasVersion && Number.isInteger(rawVersion) && rawVersion === SIDECAR_SCHEMA_VERSION
  if (!versionOk) {
    issues.push({
      kind: 'unknownVersion',
      key: 'replays.sidecar.issue.unknownVersion',
      params: { version: hasVersion ? String(rawVersion) : 'missing' },
    })
  }

  const fieldShape = sidecarFieldsSchema.shape
  for (const key of Object.keys(obj)) {
    if (key === 'schemaVersion') continue

    if (Object.prototype.hasOwnProperty.call(fieldShape, key)) {
      const fieldSchema = fieldShape[key as keyof typeof fieldShape]
      const result = fieldSchema.safeParse(obj[key])
      if (result.success) {
        ;(values as Record<string, unknown>)[key] = result.data
      } else {
        const firstIssue = result.error.issues[0]
        const path = firstIssue?.path ?? []
        const field = path.length > 0 ? `${key}.${path.join('.')}` : key
        issues.push({
          kind: 'invalidField',
          key: 'replays.sidecar.issue.invalidField',
          params: { field },
        })
      }
      continue
    }

    issues.push({
      kind: 'unknownField',
      key: 'replays.sidecar.issue.unknownField',
      params: { field: key },
    })
  }

  if (issues.length === 0) {
    return { values, state: { state: 'ok' } }
  }
  return { values, state: { state: 'error', issues } }
}

/**
 * Pure edits of a demo's time-anchored comment list: add, edit and remove one comment against the
 * list as it is now. A comment is identified by its time plus text, so an edit made against a list
 * that changed meanwhile finds its target or is refused.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC, no electron.
 */

import { SIDECAR_LIMITS, normalizeComments, type SidecarComment } from './sidecar'

export type CommentOp =
  | { kind: 'add'; atMs: number; text: string }
  | { kind: 'edit'; atMs: number; text: string; newText: string }
  | { kind: 'remove'; atMs: number; text: string }

export const COMMENT_ERROR_KEYS = {
  limit: 'replays.comments.error.limit',
  tooLong: 'replays.comments.error.tooLong',
  empty: 'replays.comments.error.empty',
  notFound: 'replays.comments.error.notFound',
} as const

export type CommentOpResult =
  | { ok: true; comments: SidecarComment[] }
  | { ok: false; key: (typeof COMMENT_ERROR_KEYS)[keyof typeof COMMENT_ERROR_KEYS] }

function checkText(text: string): CommentOpResult | null {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, key: COMMENT_ERROR_KEYS.empty }
  if (trimmed.length > SIDECAR_LIMITS.comment) return { ok: false, key: COMMENT_ERROR_KEYS.tooLong }
  return null
}

export function applyCommentOp(
  comments: readonly SidecarComment[] | undefined,
  op: CommentOp,
): CommentOpResult {
  const list = (comments ?? []).map((c) => ({ ...c }))

  if (op.kind === 'add') {
    const refused = checkText(op.text)
    if (refused !== null) return refused
    if (list.length >= SIDECAR_LIMITS.comments) return { ok: false, key: COMMENT_ERROR_KEYS.limit }
    list.push({ atMs: op.atMs, text: op.text })
    return { ok: true, comments: normalizeComments(list) }
  }

  const index = list.findIndex((c) => c.atMs === op.atMs && c.text === op.text)
  if (index < 0) return { ok: false, key: COMMENT_ERROR_KEYS.notFound }

  if (op.kind === 'remove') {
    list.splice(index, 1)
    return { ok: true, comments: normalizeComments(list) }
  }

  const refused = checkText(op.newText)
  if (refused !== null) return refused
  list[index] = { atMs: op.atMs, text: op.newText }
  return { ok: true, comments: normalizeComments(list) }
}

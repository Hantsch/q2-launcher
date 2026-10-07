import { describe, expect, it } from 'vitest'
import { applyCommentOp } from './demo-comments'

describe('demo comments', () => {
  it('add, edit and remove apply to the fresh list and refuse limit, length, empty and missing', () => {
    const added = applyCommentOp([{ atMs: 9000, text: 'late' }], {
      kind: 'add',
      atMs: 1000,
      text: '  early  ',
    })
    expect(added).toEqual({
      ok: true,
      comments: [
        { atMs: 1000, text: 'early' },
        { atMs: 9000, text: 'late' },
      ],
    })

    const edited = applyCommentOp(added.ok ? added.comments : [], {
      kind: 'edit',
      atMs: 1000,
      text: 'early',
      newText: 'earlier',
    })
    expect(edited).toEqual({
      ok: true,
      comments: [
        { atMs: 1000, text: 'earlier' },
        { atMs: 9000, text: 'late' },
      ],
    })

    const removed = applyCommentOp(edited.ok ? edited.comments : [], {
      kind: 'remove',
      atMs: 9000,
      text: 'late',
    })
    expect(removed).toEqual({ ok: true, comments: [{ atMs: 1000, text: 'earlier' }] })

    const full = Array.from({ length: 200 }, (_, i) => ({ atMs: i, text: `c${i}` }))
    expect(applyCommentOp(full, { kind: 'add', atMs: 5, text: 'one more' })).toEqual({
      ok: false,
      key: 'replays.comments.error.limit',
    })
    expect(applyCommentOp(undefined, { kind: 'add', atMs: 0, text: 'x'.repeat(501) })).toEqual({
      ok: false,
      key: 'replays.comments.error.tooLong',
    })
    expect(applyCommentOp(undefined, { kind: 'add', atMs: 0, text: '   ' })).toEqual({
      ok: false,
      key: 'replays.comments.error.empty',
    })
    expect(
      applyCommentOp([{ atMs: 1, text: 'a' }], { kind: 'edit', atMs: 1, text: 'a', newText: ' ' }),
    ).toEqual({ ok: false, key: 'replays.comments.error.empty' })
    expect(
      applyCommentOp([{ atMs: 1, text: 'a' }], { kind: 'remove', atMs: 2, text: 'a' }),
    ).toEqual({ ok: false, key: 'replays.comments.error.notFound' })
    expect(
      applyCommentOp([{ atMs: 1, text: 'a' }], {
        kind: 'edit',
        atMs: 1,
        text: 'gone',
        newText: 'b',
      }),
    ).toEqual({ ok: false, key: 'replays.comments.error.notFound' })
  })
})

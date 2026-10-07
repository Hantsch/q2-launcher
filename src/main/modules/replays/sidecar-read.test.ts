import { describe, expect, it } from 'vitest'
import { readSidecarDefensively } from './sidecar-read'

describe('readSidecarDefensively', () => {
  it('reports invalid JSON and keeps no values', () => {
    const { values, state } = readSidecarDefensively('{ not valid json')
    expect(state.state).toBe('error')
    if (state.state !== 'error') throw new Error('expected error')
    expect(state.issues).toHaveLength(1)
    expect(state.issues[0].kind).toBe('invalidJson')
    expect(values).toEqual({})
  })

  it('reports an empty file as invalid JSON', () => {
    const { values, state } = readSidecarDefensively('')
    expect(state.state).toBe('error')
    if (state.state !== 'error') throw new Error('expected error')
    expect(state.issues[0].kind).toBe('invalidJson')
    expect(values).toEqual({})
  })

  it('strips a leading UTF-8 BOM without treating it as an error', () => {
    const bytes = '﻿' + JSON.stringify({ schemaVersion: 1, name: 'x' })
    const { values, state } = readSidecarDefensively(bytes)
    expect(state).toEqual({ state: 'ok' })
    expect(values.name).toBe('x')
  })

  it('reports an array root as not an object', () => {
    const { values, state } = readSidecarDefensively('[1,2,3]')
    expect(state.state).toBe('error')
    if (state.state !== 'error') throw new Error('expected error')
    expect(state.issues).toEqual([
      { kind: 'notAnObject', key: 'replays.sidecar.issue.notAnObject', params: {} },
    ])
    expect(values).toEqual({})
  })

  it('keeps good fields and reports one bad field among them', () => {
    const bytes = JSON.stringify({ schemaVersion: 1, name: 'good', rating: 'not-a-number' })
    const { values, state } = readSidecarDefensively(bytes)
    expect(state.state).toBe('error')
    if (state.state !== 'error') throw new Error('expected error')
    const issue = state.issues.find((i) => i.kind === 'invalidField')
    expect(issue).toBeDefined()
    expect(issue?.params.field).toBe('rating')
    expect(values.name).toBe('good')
    expect(values.rating).toBeUndefined()
  })

  it('names the nested path of a bad sides entry and drops the whole field', () => {
    const bytes = JSON.stringify({ schemaVersion: 1, sides: [{ players: [1, 2] }] })
    const { values, state } = readSidecarDefensively(bytes)
    expect(state.state).toBe('error')
    if (state.state !== 'error') throw new Error('expected error')
    const issue = state.issues.find((i) => i.kind === 'invalidField')
    expect(issue).toBeDefined()
    expect(String(issue?.params.field)).toMatch(/^sides\./)
    expect(values.sides).toBeUndefined()
  })

  it('reports an unknown top-level key but keeps valid fields', () => {
    const bytes = JSON.stringify({ schemaVersion: 1, name: 'kept', extra: 'nope' })
    const { values, state } = readSidecarDefensively(bytes)
    expect(state.state).toBe('error')
    if (state.state !== 'error') throw new Error('expected error')
    expect(state.issues).toEqual([
      {
        kind: 'unknownField',
        key: 'replays.sidecar.issue.unknownField',
        params: { field: 'extra' },
      },
    ])
    expect(values.name).toBe('kept')
  })

  it('reports a newer/unknown schemaVersion but still returns valid fields', () => {
    const bytes = JSON.stringify({ schemaVersion: 999, name: 'kept' })
    const { values, state } = readSidecarDefensively(bytes)
    expect(state.state).toBe('error')
    if (state.state !== 'error') throw new Error('expected error')
    const issue = state.issues.find((i) => i.kind === 'unknownVersion')
    expect(issue?.params.version).toBe('999')
    expect(values.name).toBe('kept')
  })

  it('reports a missing schemaVersion key but still returns valid fields', () => {
    const bytes = JSON.stringify({ name: 'kept' })
    const { values, state } = readSidecarDefensively(bytes)
    expect(state.state).toBe('error')
    if (state.state !== 'error') throw new Error('expected error')
    const issue = state.issues.find((i) => i.kind === 'unknownVersion')
    expect(issue?.params.version).toBe('missing')
    expect(values.name).toBe('kept')
  })
})

describe('readSidecarDefensively comments', () => {
  it('a pre-comment v1 sidecar reads as ok with every field', () => {
    const old = {
      name: 'n',
      tags: ['a'],
      favourite: true,
      rating: 4,
      date: '2026-01-02T03:04:05Z',
    }
    const { values, state } = readSidecarDefensively(JSON.stringify({ schemaVersion: 1, ...old }))
    expect(state).toEqual({ state: 'ok' })
    expect(values).toEqual(old)

    const withComments = readSidecarDefensively(
      JSON.stringify({ schemaVersion: 1, comments: [{ atMs: 10, text: 'hi' }] }),
    )
    expect(withComments.state).toEqual({ state: 'ok' })
    expect(withComments.values.comments).toEqual([{ atMs: 10, text: 'hi' }])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentRepoHttpError, contentRepoUrl, fetchContentJson } from './content-repo'

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('content-repo', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // AC1: the manifest is fetched from engines/ and gamedata/ on main of the content repository.
  it('requests the engines manifest from the exact content-repo URL on main', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ engines: [] }))

    await fetchContentJson('engines/manifest.json')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/engines/manifest.json',
    )
  })

  it('requests the gamedata manifest from the exact content-repo URL on main', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ gamedata: [] }))

    await fetchContentJson('gamedata/manifest.json')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/gamedata/manifest.json',
    )
  })

  it('contentRepoUrl() builds the same URLs directly, including a leading-slash path', () => {
    expect(contentRepoUrl('engines/manifest.json')).toBe(
      'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/engines/manifest.json',
    )
    expect(contentRepoUrl('/gamedata/manifest.json')).toBe(
      'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/gamedata/manifest.json',
    )
  })

  it('passes an AbortSignal to fetch, derived from the default 10s timeout', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    await fetchContentJson('engines/manifest.json')

    const options = fetchMock.mock.calls[0][1] as { signal?: unknown }
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('honours a custom timeoutMs by asking AbortSignal.timeout for it', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    await fetchContentJson('engines/manifest.json', { timeoutMs: 5_000 })

    expect(timeoutSpy).toHaveBeenCalledWith(5_000)
    timeoutSpy.mockRestore()
  })

  it('throws an inspectable error carrying the status on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 404 }))

    await expect(fetchContentJson('engines/manifest.json')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('the thrown error is a ContentRepoHttpError instance for 500s too', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 500 }))

    const error = await fetchContentJson('gamedata/manifest.json').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ContentRepoHttpError)
    expect((error as ContentRepoHttpError).status).toBe(500)
  })
})

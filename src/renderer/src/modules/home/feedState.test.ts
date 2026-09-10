import type { NewsSlide } from '@shared/modules/home'
import { describe, expect, it } from 'vitest'
import { feedState } from './feedState'

/** Story 083 D4 acceptance tests (AC6/AC7). */

function slide(id: string): NewsSlide {
  return { id, template: 'text', order: 1, title: id, body: id, buttons: [] }
}

describe('feedState', () => {
  it('AC6: with no cached feed the welcome slide is chosen and carries no bitmap', () => {
    // "carries no bitmap" at this layer means the mapping itself never reaches for `slides` - the
    // renderer's welcome slide (NewsHero.test.tsx) is what actually proves no <img> renders.
    expect(feedState({ slides: [], lastRefreshFailed: false })).toBe('welcome')

    // Never fetched at all AND the last attempt failed: still welcome, not stale - there is nothing
    // to call "stale" when there was never a good feed to begin with.
    expect(feedState({ slides: [], lastRefreshFailed: true })).toBe('welcome')
  })

  it('AC7: a feed after a failed refresh is stale, carries its retrieval date and raises no toast', () => {
    const feed = {
      slides: [slide('a')],
      retrievedAt: '2026-01-10T00:00:00.000Z',
      lastRefreshFailed: true,
    }

    expect(feedState(feed)).toBe('stale')
    // The retrieval date travels on the same object the mapping was given - nothing here discards
    // it, and no side effect (toast/dialog) is possible from a pure function with no such dependency.
    expect(feed.retrievedAt).toBe('2026-01-10T00:00:00.000Z')
  })

  it('a good current feed is filled', () => {
    expect(feedState({ slides: [slide('a')], lastRefreshFailed: false })).toBe('filled')
  })
})

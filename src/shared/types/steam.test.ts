import { describe, expect, it } from 'vitest'
import { STEAM_APP_CLIENTS, steamLaunchUrl } from './steam'

describe('STEAM_APP_CLIENTS', () => {
  it('maps 2320 to its four clients, original by default', () => {
    const table = STEAM_APP_CLIENTS['2320']
    expect(table.clients).toHaveLength(4)
    expect(table.clients.map((c) => c.index)).toEqual([1, 2, 3, 4])
    expect(table.clients).toEqual([
      { index: 1, labelKey: 'steam.client.enhanced' },
      { index: 2, labelKey: 'steam.client.original' },
      { index: 3, labelKey: 'steam.client.reckoning' },
      { index: 4, labelKey: 'steam.client.groundZero' },
    ])
    expect(table.defaultIndex).toBe(2)
  })
})

describe('steamLaunchUrl', () => {
  it('builds the launch URL for each of 2320s clients, original by default', () => {
    expect(steamLaunchUrl('2320', 1)).toBe('steam://launch/2320/client/1')
    expect(steamLaunchUrl('2320', 2)).toBe('steam://launch/2320/client/2')
    expect(steamLaunchUrl('2320', 3)).toBe('steam://launch/2320/client/3')
    expect(steamLaunchUrl('2320', 4)).toBe('steam://launch/2320/client/4')
  })

  it('refuses an unknown appid', () => {
    expect(steamLaunchUrl('99999', 2)).toBeUndefined()
  })

  it('refuses an index not in the table for a known appid', () => {
    expect(steamLaunchUrl('2320', 5)).toBeUndefined()
    expect(steamLaunchUrl('2320', 0)).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { toFolderName } from './downloads-folder-name'

describe('toFolderName', () => {
  it('keeps an ordinary name as it is', () => {
    expect(toFolderName('My Quake II')).toBe('My Quake II')
  })

  it('replaces characters Windows forbids in a folder name', () => {
    expect(toFolderName('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(toFolderName('tab\there')).toBe('tab_here')
  })

  it('trims whitespace and trailing dots and spaces', () => {
    expect(toFolderName('  name. . ')).toBe('name')
  })

  it('appends an underscore to a reserved device name', () => {
    expect(toFolderName('NUL')).toBe('NUL_')
    expect(toFolderName('com1.txt')).toBe('com1.txt_')
  })

  it('falls back to Quake II when nothing usable is left', () => {
    expect(toFolderName('')).toBe('Quake II')
    expect(toFolderName(' . ')).toBe('Quake II')
  })

  it('caps the name at 120 characters', () => {
    expect(toFolderName('x'.repeat(300))).toHaveLength(120)
  })
})

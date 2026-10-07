/**
 * Windows reserved device names, checked against a path's final segment without its extension
 * (`NUL.txt` is exactly as unusable as `NUL`). Lowercase; callers compare case-insensitively.
 */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

const FORBIDDEN_CHARS = '<>:"/' + String.fromCharCode(92) + '|?*'
const FALLBACK_FOLDER_NAME = 'Quake II'
const MAX_FOLDER_NAME_LENGTH = 120

export function isReservedDeviceStem(stem: string): boolean {
  return RESERVED_DEVICE_NAMES.has(stem.toLowerCase())
}

/** Turns an installation name into a folder name that is valid on Windows and Linux. (story 240) */
export function toFolderName(name: string): string {
  const cleaned = Array.from(name, (ch) =>
    ch.charCodeAt(0) < 0x20 || FORBIDDEN_CHARS.includes(ch) ? '_' : ch,
  )
    .join('')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, MAX_FOLDER_NAME_LENGTH)
    .replace(/[. ]+$/, '')
  if (cleaned === '') return FALLBACK_FOLDER_NAME
  const stem = cleaned.split('.')[0] ?? ''
  return isReservedDeviceStem(stem) ? `${cleaned}_` : cleaned
}

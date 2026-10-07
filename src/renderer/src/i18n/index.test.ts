import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { i18next, initI18n } from './index'

describe('missing translation keys', () => {
  beforeAll(async () => {
    await initI18n('en')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the caller's defaultValue when the key is missing", () => {
    expect(i18next.t('no.such.key', { defaultValue: 'Fallback label' })).toBe('Fallback label')
  })

  it('renders the key itself when the key is missing and no defaultValue is given', () => {
    // A key without a fallback is a dev-time bug and is reported; the report is not under test.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(i18next.t('no.such.key')).toBe('no.such.key')
  })
})

describe('the merged bundle', () => {
  beforeAll(async () => {
    await initI18n('en')
  })

  it('initI18n resolves a key from the shell file and from every module locale', () => {
    expect(i18next.t('app.name')).toBe('Q2 Launcher')
    expect(i18next.t('config.subtitle', { count: 1 })).toBe('1 profile')
    expect(i18next.t('servers.tabs.label')).toBe('Servers views')
    expect(i18next.t('replays.module.description')).toBe(
      'Browse, tag and watch your Quake II demos.',
    )
    expect(i18next.t('mods.view.selectedInstallation')).toBe('Selected installation')
    expect(i18next.t('home.dashboard.arrange.on')).toBe('Done arranging')
    expect(i18next.t('downloads.job.bootstrap', { name: 'X' })).toBe('Setting up X')
  })
})

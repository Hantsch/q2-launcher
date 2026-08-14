import i18next, { type i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { LocaleSetting } from '@shared/types'
import en from './locales/en.json'

/**
 * All user-visible text lives in `locales/*.json`, including the messages the
 * main process produces - main sends i18n keys, never prose.
 *
 * Only English ships today. Adding a language is: drop in `xx.json`, add it to
 * `LOCALE_BUNDLES` and to `LocaleSetting` in `src/shared/types/settings.ts`.
 * No component changes.
 */
const LOCALE_BUNDLES = {
  en,
} as const

export type SupportedLocale = keyof typeof LOCALE_BUNDLES

export const SUPPORTED_LOCALES = Object.keys(LOCALE_BUNDLES) as SupportedLocale[]

export const FALLBACK_LOCALE: SupportedLocale = 'en'

/** Turns the stored setting (which may be `system`) into a locale we actually have. */
export function resolveLocale(setting: LocaleSetting): SupportedLocale {
  if (setting !== 'system') return setting
  const preferred = navigator.languages ?? [navigator.language]
  for (const tag of preferred) {
    const base = tag.split('-')[0]?.toLowerCase()
    if (base && (SUPPORTED_LOCALES as string[]).includes(base)) return base as SupportedLocale
  }
  return FALLBACK_LOCALE
}

export async function initI18n(setting: LocaleSetting): Promise<I18nInstance> {
  await i18next.use(initReactI18next).init({
    lng: resolveLocale(setting),
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: SUPPORTED_LOCALES,
    resources: Object.fromEntries(
      Object.entries(LOCALE_BUNDLES).map(([locale, bundle]) => [locale, { translation: bundle }]),
    ),
    interpolation: {
      // React escapes for us; double-escaping mangles apostrophes and quotes.
      escapeValue: false,
    },
    // A missing key is a bug we want to see, not a blank label in the UI.
    parseMissingKeyHandler: (key) => {
      if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`)
      return key
    },
  })

  return i18next
}

export async function changeLocale(setting: LocaleSetting): Promise<void> {
  await i18next.changeLanguage(resolveLocale(setting))
}

export { i18next }

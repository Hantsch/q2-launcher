import { useTranslation } from 'react-i18next'
import heroUrl from '../../assets/boot-hero.avif'

/**
 * Shown for the few frames between the window appearing and main answering the
 * first batch of IPC calls.
 *
 * The one place in the launcher that uses artwork: the official Quake II
 * re-release hero still, behind a scrim heavy enough that the wordmark keeps
 * its contrast. Everything after this frame is CSS and inline SVG again.
 */
export function BootSplash() {
  const { t } = useTranslation()

  return (
    <div className="boot-splash relative h-full overflow-hidden bg-void">
      {/* Decorative: the wordmark below carries the meaning. */}
      <img src={heroUrl} alt="" aria-hidden className="boot-hero" />
      <div className="boot-scrim" />

      {/* The still already carries the Quake II logo, so the caption stays out of
          its way: bottom-anchored, and it names the launcher rather than the game. */}
      <div className="relative flex h-full flex-col items-center justify-end pb-16">
        <div className="flex w-64 flex-col items-center gap-3">
          <div className="font-display text-[22px] leading-none font-semibold tracking-[0.38em] text-ink uppercase">
            {t('app.tagline')}
          </div>

          <div className="progress-track w-full" role="presentation">
            <div className="progress-fill" data-indeterminate="true" />
          </div>

          <div className="stencil text-[10px] text-ink-muted">{t('app.boot.status')}</div>
        </div>
      </div>
    </div>
  )
}

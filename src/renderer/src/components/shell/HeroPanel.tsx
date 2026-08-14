import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Search } from 'lucide-react'
import { engineLabel } from '@shared/types'
import { cn } from '../../lib/cn'
import { formatDuration, formatRelativeTime, shortenPath } from '../../lib/format'
import { statusTone } from '../../lib/status'
import { useActiveInstallation, useLauncher } from '../../store/useLauncher'
import { Badge, StatusDot } from '../ui/primitives'
import { Button } from '../ui/Button'
import { ChecksList } from '../installations/ChecksList'

/** Placeholder slots for the news carousel a future module will fill. */
const SLIDE_COUNT = 4

/** One figure in the hero's stat strip. */
function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="stencil text-[9px]">{label}</dt>
      <dd className="numeric text-sm text-ink-dim">{value}</dd>
    </div>
  )
}

/**
 * The key-art stage.
 *
 * With no licensed artwork to ship, the visual is generated: `.hero-fallback`
 * builds a Strogg furnace out of gradients, and a heavy vignette guarantees the
 * overlaid text stays readable whatever lands here later.
 */
export function HeroPanel() {
  const { t } = useTranslation()
  const installation = useActiveInstallation()
  const openDialog = useLauncher((state) => state.openDialog)
  const [slide, setSlide] = useState(0)

  const tone = installation ? statusTone(installation.status) : null
  const lastPlayed = formatRelativeTime(installation?.lastPlayedAt)
  const needsAttention =
    installation !== null && installation.status !== 'ok' && installation.checks.length > 0

  return (
    // `min-h` matters: the hero aligns its content to the bottom, so when the
    // box is allowed to shrink below the content height it is the title that
    // disappears off the top.
    <section className="hero-fallback scanlines relative flex min-h-[240px] flex-1 flex-col justify-end overflow-hidden rounded-md border border-line">
      {/* Content sits above the ::before/::after texture layers. */}
      <div className="relative z-10 flex items-end justify-between gap-8 p-7">
        <div className="max-w-2xl space-y-3">
          <div className="stencil text-flame-400">
            {installation ? t('hero.eyebrow') : t('empty.title')}
          </div>

          <h1 className="font-display text-4xl leading-none font-semibold tracking-[0.02em] text-ink uppercase">
            {installation?.name ?? t('hero.noInstallTitle')}
          </h1>

          {installation ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={installation.engineKind === 'r1q2' ? 'flame' : 'neutral'}>
                  {engineLabel(installation.engineKind)}
                </Badge>
                {installation.detectedVersion && (
                  <Badge tone="neutral">{installation.detectedVersion}</Badge>
                )}
                <Badge tone="neutral">{t(`installation.source.${installation.source}`)}</Badge>
                {tone && (
                  <span className={cn('flex items-center gap-1.5 text-xs', tone.text)}>
                    <StatusDot className={tone.dot} />
                    {t(tone.labelKey)}
                  </span>
                )}
              </div>

              <p
                className="numeric text-xs text-ink-muted"
                title={installation.rootPath}
                data-selectable
              >
                {shortenPath(installation.rootPath, 64)}
              </p>

              {needsAttention ? (
                <div className="max-w-xl rounded-md border border-line-strong bg-void/55 p-3 backdrop-blur-sm">
                  <ChecksList installation={installation} />
                </div>
              ) : (
                <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2 pt-1">
                  <HeroStat
                    label={t('hero.stat.lastPlayed')}
                    value={lastPlayed ?? t('common.never')}
                  />
                  <HeroStat
                    label={t('hero.stat.playtime')}
                    value={
                      installation.totalPlaytimeSeconds > 0
                        ? formatDuration(installation.totalPlaytimeSeconds)
                        : '-'
                    }
                  />
                  <HeroStat
                    label={t('hero.stat.gameDirs')}
                    value={String(installation.gameDirs.length)}
                  />
                  <HeroStat
                    label={t('hero.stat.client')}
                    value={engineLabel(installation.engineKind)}
                  />
                </dl>
              )}
            </>
          ) : (
            <>
              <p className="max-w-xl text-sm leading-relaxed text-ink-dim">{t('empty.body')}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="primary"
                  icon={<FolderOpen className="size-4" />}
                  onClick={() => openDialog({ kind: 'add-existing' })}
                >
                  {t('rail.addExisting')}
                </Button>
                <Button
                  variant="neutral"
                  icon={<Search className="size-4" />}
                  onClick={() => openDialog({ kind: 'detect' })}
                >
                  {t('rail.autoDetect')}
                </Button>
              </div>
              <p className="text-xs text-ink-muted">{t('empty.hint')}</p>
            </>
          )}
        </div>

        {/* Carousel dots: the news module's future home, wired but empty. */}
        <div className="flex shrink-0 items-center gap-2 pb-1">
          {Array.from({ length: SLIDE_COUNT }, (_, index) => (
            <button
              key={index}
              type="button"
              aria-label={t('hero.slide', { index: index + 1 })}
              onClick={() => setSlide(index)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-[--dur-base] ease-[--ease-out-quart]',
                index === slide ? 'w-6 bg-flame-500' : 'w-1.5 bg-ink-faint hover:bg-ink-muted',
              )}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

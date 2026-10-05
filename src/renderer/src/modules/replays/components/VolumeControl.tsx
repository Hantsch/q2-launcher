import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Volume2, VolumeX } from 'lucide-react'
import { IconButton } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'
import type { PlaybackVolume } from '../playback-store'

export interface VolumeControlProps {
  volume: PlaybackVolume
  disabled?: boolean
  focusRing: string
  onChange: (volume: PlaybackVolume) => void
}

/**
 * The speaker button and volume slider of the timeline strip. Muting keeps the level, so unmute
 * restores it; muted shows as a crossed-out speaker plus the "Muted" text, never colour alone.
 * (story 237)
 */
export function VolumeControl({
  volume,
  disabled = false,
  focusRing,
  onChange,
}: VolumeControlProps) {
  const { t } = useTranslation()
  // While the user drags, their value wins over display pushes that lag behind it.
  const [local, setLocal] = useState<number | null>(null)
  const level = local ?? volume.percent
  const { muted } = volume
  const text = muted
    ? t('replays.timeline.volume.muted')
    : t('replays.timeline.volume.percent', { value: level })
  const release = (): void => setLocal(null)

  return (
    <div className="mr-2 flex items-center gap-1">
      <IconButton
        size="lg"
        label={muted ? t('replays.timeline.volume.unmute') : t('replays.timeline.volume.mute')}
        disabled={disabled}
        aria-pressed={muted}
        onClick={() => onChange({ percent: level, muted: !muted })}
        className={focusRing}
        data-testid="replays-timeline-volume-toggle"
      >
        {muted ? <VolumeX className="size-6" /> : <Volume2 className="size-6" />}
      </IconButton>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={level}
        disabled={disabled}
        aria-label={t('replays.timeline.volume.label')}
        aria-valuetext={text}
        onChange={(event) => {
          const percent = Number(event.target.value)
          setLocal(percent)
          onChange({ percent, muted: false })
        }}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
        className={cn(
          'h-11 w-24 cursor-pointer accent-flame-500 disabled:cursor-not-allowed disabled:opacity-60',
          focusRing,
        )}
        data-testid="replays-timeline-volume"
      />
      <span
        className="w-12 text-sm text-ink-muted tabular-nums"
        data-testid="replays-timeline-volume-label"
      >
        {text}
      </span>
    </div>
  )
}

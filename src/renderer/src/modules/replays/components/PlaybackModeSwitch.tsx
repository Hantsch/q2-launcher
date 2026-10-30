import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PLAYER_MODES, type PlayerMode } from '@shared/replays/player-mode'
import { SegmentedControl } from '../../../components/ui/SegmentedControl'
import { usePlaybackModeStore } from '../playback-mode-store'
import { usePlaybackStore } from '../playback-store'

/** Engine window / integrated player choice; locked while a demo plays so a session never changes mode mid-way. (story 287) */
export function PlaybackModeSwitch({ testIdPrefix }: { testIdPrefix: string }) {
  const { t } = useTranslation()
  const mode = usePlaybackModeStore((s) => s.mode)
  const busy = usePlaybackModeStore((s) => s.busy)
  const error = usePlaybackModeStore((s) => s.error)
  const load = usePlaybackModeStore((s) => s.load)
  const set = usePlaybackModeStore((s) => s.set)
  const playing = usePlaybackStore((s) => s.session !== null)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-1.5">
      <SegmentedControl<PlayerMode>
        label={t('replays.player.mode.label')}
        options={PLAYER_MODES.map((value) => ({
          value,
          label:
            value === 'engine'
              ? t('replays.player.mode.engine')
              : t('replays.player.mode.integrated'),
          testId: `${testIdPrefix}-${value}`,
        }))}
        value={mode}
        onChange={(next) => void set(next)}
        disabled={playing || busy}
      />
      {playing && (
        <p className="text-xs text-ink-muted" data-testid={`${testIdPrefix}-locked`}>
          {t('replays.player.mode.lockedWhilePlaying')}
        </p>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {t(error.key, error.params)}
        </p>
      )}
    </div>
  )
}

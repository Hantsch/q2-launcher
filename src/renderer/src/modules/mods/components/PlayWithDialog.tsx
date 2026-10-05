import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Installation } from '@shared/types'
import type { ModLastLaunch } from '@shared/modules/mods'
import { Button } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import { useModuleQuery } from '../../../lib/useModuleQuery'
import { useLauncher } from '../../../store/useLauncher'
import { getLastLaunch, listMaps, rememberLastLaunch } from '../client'

type GameType = ModLastLaunch['gameType']

/** baseq2 is the base game, written `''` everywhere a launch choice names a mod. */
const baseGameName = (gameDir: string): string => (gameDir === 'baseq2' ? '' : gameDir)

/**
 * The "Play with..." dialog: pick mod, map and game type for one start. The last choice is
 * remembered per installation; anything remembered that no longer exists falls back to the
 * installation's own defaults (story 249).
 */
export function PlayWithDialog({ installationId }: { installationId: string }) {
  const { t } = useTranslation()
  const installation = useLauncher((s) => s.installations.find((i) => i.id === installationId))
  const closeDialog = useLauncher((s) => s.closeDialog)
  const last = useModuleQuery(() => getLastLaunch(installationId), { deps: [installationId] })

  return (
    <Modal
      open
      size="md"
      title={t('mods.playWith.title', { installation: installation?.name ?? '' })}
      onClose={closeDialog}
      closeLabel={t('common.action.close')}
    >
      <div data-testid="play-with-dialog">
        {installation && last.state === 'success' && (
          <PlayWithForm installation={installation} remembered={last.data ?? null} />
        )}
      </div>
    </Modal>
  )
}

function PlayWithForm({
  installation,
  remembered,
}: {
  installation: Installation
  remembered: ModLastLaunch | null
}) {
  const { t } = useTranslation()
  const closeDialog = useLauncher((s) => s.closeDialog)
  const mods = useMemo(
    () => installation.gameDirs.filter((dir) => dir !== 'baseq2'),
    [installation.gameDirs],
  )
  const fallbackDir = baseGameName(installation.activeGameDir)
  const exists = (dir: string): boolean => dir === '' || mods.includes(dir)
  const [gameDir, setGameDir] = useState(
    remembered && exists(remembered.gameDir) ? remembered.gameDir : fallbackDir,
  )
  const [map, setMap] = useState(remembered?.map ?? '')
  const [gameType, setGameType] = useState<GameType>(remembered?.gameType ?? 'deathmatch')

  const maps = useModuleQuery(() => listMaps(installation.id, gameDir), {
    deps: [installation.id, gameDir],
  })
  const loaded = maps.state === 'success'
  const list = useMemo(() => (loaded ? (maps.data?.maps ?? []) : []), [loaded, maps.data])
  // A map the (new) list does not offer is No map; it comes back if the list offers it again.
  const chosenMap = list.some((entry) => entry.name === map) ? map : ''

  const start = async (): Promise<void> => {
    await rememberLastLaunch(installation.id, { gameDir, map: chosenMap || null, gameType })
    await useLauncher.getState().play(installation.id, {
      gameDir,
      ...(chosenMap ? { map: chosenMap, gameType } : {}),
    })
    closeDialog()
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm text-ink">
        {t('common.label.mod')}
        <Select
          value={gameDir}
          onChange={(e) => setGameDir(e.target.value)}
          options={[
            { value: '', label: t('mods.playWith.baseGame') },
            ...mods.map((dir) => ({ value: dir, label: dir })),
          ]}
          data-testid="play-with-mod"
        />
      </label>
      <label className="block space-y-1 text-sm text-ink">
        {t('common.label.map')}
        <Select
          value={chosenMap}
          onChange={(e) => setMap(e.target.value)}
          disabled={!loaded}
          options={[
            { value: '', label: t('mods.playWith.noMap') },
            ...list.map((entry) => ({
              value: entry.name,
              label: entry.title ? `${entry.name} — ${entry.title}` : entry.name,
            })),
          ]}
          data-testid="play-with-map"
        />
      </label>
      {!loaded && (
        <p className="text-xs text-ink-dim" role="status">
          {t('mods.playWith.loadingMaps')}
        </p>
      )}
      <label className="block space-y-1 text-sm text-ink">
        {t('mods.playWith.gameType')}
        <Select
          value={gameType}
          onChange={(e) => setGameType(e.target.value as GameType)}
          disabled={chosenMap === ''}
          options={[
            { value: 'deathmatch', label: t('mods.playWith.deathmatch') },
            { value: 'single', label: t('mods.playWith.single') },
          ]}
          data-testid="play-with-gametype"
        />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={closeDialog}>
          {t('common.action.cancel')}
        </Button>
        <Button disabled={!loaded} onClick={() => void start()} data-testid="play-with-start">
          {t('mods.playWith.start')}
        </Button>
      </div>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { FlaskConical } from 'lucide-react'
import type { InvokeRequest } from '@shared/ipc'
import { invoke } from '../../lib/bridge'
import { Button } from '../ui/Button'

const JOB_SCENARIOS: Array<{ labelKey: string; payload: InvokeRequest<'dev:simulateJob'> }> = [
  { labelKey: 'settings.simulateJob', payload: { scenario: 'success' } },
  { labelKey: 'settings.simulateJobStall', payload: { scenario: 'stall' } },
  { labelKey: 'settings.simulateJobFailure', payload: { scenario: 'failure' } },
]

const UPDATE_SCENARIOS: Array<{
  labelKey: string
  payload: InvokeRequest<'dev:simulateAppUpdate'>
}> = [
  {
    labelKey: 'settings.simulateUpdateAvailable',
    payload: {
      scenario: 'available',
      version: '9.9.9-dev',
      notes: 'Simulated release notes for dev testing.',
    },
  },
  { labelKey: 'settings.simulateUpdateProgress', payload: { scenario: 'progress', ratio: 0.5 } },
  { labelKey: 'settings.simulateUpdateDownloaded', payload: { scenario: 'downloaded' } },
  { labelKey: 'settings.simulateUpdateError', payload: { scenario: 'error', reason: 'offline' } },
  { labelKey: 'settings.simulateUpdateUpToDate', payload: { scenario: 'upToDate' } },
]

/** Development builds only: buttons that fake a download job or drive the update control. */
export function DevToolsPanel() {
  const { t } = useTranslation()

  return (
    <>
      <p className="text-xs leading-relaxed text-ink-muted">
        Development builds only. Emits a fake download job so the action bar&rsquo;s progress
        readout and the Downloads tab can be worked on before the downloads module exists.
      </p>
      <div className="flex flex-wrap gap-2">
        {JOB_SCENARIOS.map(({ labelKey, payload }) => (
          <Button
            key={labelKey}
            variant="neutral"
            size="sm"
            icon={<FlaskConical className="size-3.5" />}
            onClick={() => void invoke('dev:simulateJob', payload)}
          >
            {t(labelKey)}
          </Button>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        Story 098 D4. Drives the update control through every phase without a real check or
        download.
      </p>
      <div className="flex flex-wrap gap-2">
        {UPDATE_SCENARIOS.map(({ labelKey, payload }) => (
          <Button
            key={labelKey}
            variant="neutral"
            size="sm"
            icon={<FlaskConical className="size-3.5" />}
            onClick={() => void invoke('dev:simulateAppUpdate', payload)}
          >
            {t(labelKey)}
          </Button>
        ))}
      </div>
    </>
  )
}

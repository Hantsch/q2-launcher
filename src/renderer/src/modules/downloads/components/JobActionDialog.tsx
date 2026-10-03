import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Job } from '@shared/types'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { RunningStep } from '../bootstrap/RunningStep'

/**
 * A dialog whose primary action starts a job. Until `jobId` is set it shows the caller's `children`
 * and `footer`; afterwards it hands over to `RunningStep` with a dismiss button. The dialog cannot
 * be closed while the start request is in flight.
 */
export function JobActionDialog({
  title,
  description,
  onClose,
  starting,
  jobId,
  job,
  dismissTestId,
  footer,
  children,
}: {
  title: string
  description: string
  onClose: () => void
  starting: boolean
  jobId: string | null
  job: Job | undefined
  dismissTestId: string
  footer: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const running = !!jobId

  return (
    <Modal
      open
      title={title}
      description={description}
      onClose={onClose}
      closeLabel={t('common.action.close')}
      preventClose={starting}
      footer={
        running ? (
          <Button variant="primary" onClick={onClose} data-testid={dismissTestId}>
            {t('common.action.runInBackground')}
          </Button>
        ) : (
          footer
        )
      }
    >
      {running ? <RunningStep job={job} /> : children}
    </Modal>
  )
}

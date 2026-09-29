import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocalizedMessage } from '@shared/types'
import { validateConsoleLine } from '@shared/replays/console-line'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { consoleSend } from '../client'
import { useLauncher } from '../../../store/useLauncher'
import { usePlaybackStore } from '../playback-store'

/**
 * Story 166 D4: the one-line console field next to the timeline. It is always rendered; without a
 * demo session the input and Send are disabled and the reason is visible text. The shared validator
 * gives the immediate reason (an empty line just disables Send, no error); main's refusal shows in
 * the same slot and keeps the text. A successful send clears the field.
 */
export function ConsoleCommandField() {
  const { t } = useTranslation()
  const reasonId = useId()
  const hasSession = usePlaybackStore((state) => state.session !== null)
  const platform = useLauncher((state) => state.appInfo?.platform ?? '')
  const showStageHint = usePlaybackStore(
    (state) =>
      platform === 'win32' && state.session !== null && state.session.view?.ended !== true && !state.session.fullscreen,
  )
  const [line, setLine] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<LocalizedMessage | null>(null)

  const validation = validateConsoleLine(line)
  const localReason = !validation.ok && validation.reason !== 'empty' ? validation.reason : null
  const reason = !hasSession
    ? t('replays.console.disabled.noSession')
    : localReason !== null
      ? t(`replays.console.error.${localReason}`)
      : serverError
        ? t(serverError.key, serverError.params)
        : null
  const canSend = hasSession && validation.ok && !submitting

  async function submit(): Promise<void> {
    if (!canSend) return
    setSubmitting(true)
    setServerError(null)
    try {
      const outcome = await consoleSend(line)
      if (outcome.ok) setLine('')
      else setServerError(outcome.error)
    } catch {
      setServerError({ key: 'replays.console.error.noSession' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      className="flex flex-col gap-1 border-t border-line bg-panel px-5 py-2"
      aria-label={t('replays.console.label')}
      data-testid="replays-console-field"
    >
      <Field label={t('replays.console.label')}>
        <div className="flex items-center gap-2">
          <Input
            value={line}
            disabled={!hasSession}
            placeholder={t('replays.console.placeholder')}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={reason !== null ? reasonId : undefined}
            aria-invalid={localReason !== null || serverError !== null}
            data-testid="replays-console-input"
            className="focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame-500"
            onChange={(event) => {
              setLine(event.target.value)
              setServerError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <Button
            variant="primary"
            disabled={!canSend}
            onClick={() => void submit()}
            data-testid="replays-console-send"
          >
            {t('replays.console.send')}
          </Button>
        </div>
      </Field>
      {reason === null && <div className="min-h-4" aria-hidden="true" data-testid="replays-console-reason-slot" />}
      {reason !== null && (
        <p
          id={reasonId}
          className={hasSession ? 'min-h-4 text-xs text-danger' : 'min-h-4 text-xs text-ink-muted'}
          role={hasSession ? 'alert' : undefined}
          data-testid="replays-console-reason"
        >
          {reason}
        </p>
      )}
      {showStageHint && (
        <p className="text-xs text-ink-muted" data-testid="replays-console-stage-hint">
          {t('replays.console.stageInputHint')}
        </p>
      )}
    </section>
  )
}

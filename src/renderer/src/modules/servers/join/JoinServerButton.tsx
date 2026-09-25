import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServerListRow } from '@shared/modules/servers'
import { parseServerAddress, serverAddressRejectionKey } from '@shared/servers/address'
import { parseUserinfoValue, userinfoRejectionKey } from '@shared/launch/userinfo'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import { useActiveInstallation, useLauncher } from '../../../store/useLauncher'
import { modMismatch, needsPassword, type JoinMode, type ModMismatch } from './join-flow'

/**
 * Story 125 D4 (join mode) / 126 D3 (spectate mode): the join/spectate flow itself. A single
 * button that, in order, validates the address, warns on a mod mismatch (with a way to join
 * anyway), prompts for a password when the server needs one, then calls `play()` with
 * `+connect`/`userinfo` set - never argv, per `src/shared/launch/userinfo.ts`'s own reasoning.
 *
 * `mode` (default `'join'`) picks which of the two flows this renders as: the button's label and
 * testid, which password bit gates the prompt (`needpass` for join, `spectatorPass` for
 * spectate - the other bit is ignored entirely in that mode), the password prompt's title/label
 * i18n keys, and whether `play()` is called with `spectate: true`. There is deliberately only one
 * implementation of the flow - `mode` only ever changes labels/keys/flags, never the steps
 * themselves.
 *
 * No active installation: the button stays visible and disabled (CLAUDE.md's "never silently
 * omitted" rule), with `servers.join.noInstallation` rendered as real text next to it, mirroring
 * how other disabled-with-reason controls in this module (e.g. `ServersView`'s blocked-scan text)
 * surface their reason inline rather than only in a tooltip.
 */
export function JoinServerButton({ row, mode = 'join' }: { row: ServerListRow; mode?: JoinMode }) {
  const { t } = useTranslation()
  const installation = useActiveInstallation()
  const [addressError, setAddressError] = useState<string | null>(null)
  const [mismatch, setMismatch] = useState<ModMismatch | null>(null)
  const [pendingConnect, setPendingConnect] = useState<string | null>(null)
  const [askPassword, setAskPassword] = useState(false)
  const [password, setPassword] = useState('')

  const spectating = mode === 'spectate'
  const actionTestId = spectating ? 'servers-spectate' : 'servers-join'

  const closeMismatch = (): void => {
    setMismatch(null)
    setPendingConnect(null)
  }

  const closePassword = (): void => {
    setAskPassword(false)
    setPendingConnect(null)
    setPassword('')
  }

  const launch = (connect: string, userinfoPassword?: string): void => {
    void useLauncher
      .getState()
      .play(undefined, {
        connect,
        userinfo: userinfoPassword ? { password: userinfoPassword } : undefined,
        ...(spectating ? { spectate: true } : {}),
      })
  }

  const proceedAfterMismatch = (connect: string): void => {
    if (needsPassword(row, mode)) {
      setPendingConnect(connect)
      setAskPassword(true)
      return
    }
    launch(connect)
  }

  const handleClick = (): void => {
    setAddressError(null)
    const result = parseServerAddress(row.address)
    if (!result.ok) {
      setAddressError(t(serverAddressRejectionKey(result.reason)))
      return
    }

    if (installation) {
      const mismatchResult = modMismatch(row, installation)
      if (mismatchResult) {
        setPendingConnect(result.normalized)
        setMismatch(mismatchResult)
        return
      }
    }

    proceedAfterMismatch(result.normalized)
  }

  const confirmMismatch = (): void => {
    const connect = pendingConnect
    setMismatch(null)
    if (connect) proceedAfterMismatch(connect)
  }

  const passwordValidation = parseUserinfoValue(password)
  const passwordError =
    password.length > 0 && !passwordValidation.ok
      ? t(userinfoRejectionKey(passwordValidation.reason))
      : null

  const submitPassword = (): void => {
    if (!pendingConnect || !passwordValidation.ok) return
    const connect = pendingConnect
    const value = password
    closePassword()
    launch(connect, value)
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="neutral"
        onClick={handleClick}
        disabled={!installation}
        data-testid={actionTestId}
      >
        {t(spectating ? 'servers.spectate.action' : 'servers.join.action')}
      </Button>
      {!installation && (
        <span className="text-xs text-ink-muted" data-testid="servers-join-no-installation">
          {t('servers.join.noInstallation')}
        </span>
      )}
      {addressError && (
        <span className="text-xs text-danger" data-testid="servers-join-refused">
          {addressError}
        </span>
      )}

      <Modal
        open={mismatch !== null}
        size="sm"
        title={t('servers.join.mismatch.title')}
        onClose={closeMismatch}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closeMismatch}
              data-testid="servers-join-mismatch-cancel"
            >
              {t('servers.join.mismatch.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={confirmMismatch}
              data-testid="servers-join-mismatch-confirm"
            >
              {t('servers.join.mismatch.confirm')}
            </Button>
          </>
        }
      >
        <div data-testid="servers-join-mismatch">
          <p className="text-sm text-ink">
            {mismatch &&
              t('servers.join.mismatch.body', {
                server: mismatch.server,
                installation: mismatch.installation,
              })}
          </p>
        </div>
      </Modal>

      <Modal
        open={askPassword}
        size="sm"
        title={t(spectating ? 'servers.spectate.passwordTitle' : 'servers.join.password.title')}
        onClose={closePassword}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closePassword}
              data-testid="servers-join-password-cancel"
            >
              {t('servers.join.password.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={submitPassword}
              disabled={!passwordValidation.ok}
              data-testid="servers-join-password-submit"
            >
              {t(spectating ? 'servers.spectate.passwordSubmit' : 'servers.join.password.submit')}
            </Button>
          </>
        }
      >
        <div data-testid="servers-join-password">
          <Field
            label={t(spectating ? 'servers.spectate.passwordLabel' : 'servers.join.password.label')}
            error={passwordError ?? undefined}
          >
            <Input
              type="password"
              value={password}
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && passwordValidation.ok) submitPassword()
              }}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

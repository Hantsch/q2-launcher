import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServerListRow } from '@shared/modules/servers'
import { parseServerAddress, serverAddressRejectionKey } from '@shared/servers/address'
import { parseUserinfoValue, userinfoRejectionKey } from '@shared/launch/userinfo'
import { Button } from '../../../components/ui/Button'
import { Field, Input } from '../../../components/ui/controls'
import { Modal } from '../../../components/ui/Modal'
import { useLauncher } from '../../../store/useLauncher'
import { needsJoinPassword } from './join-flow'

interface Pending {
  row: ServerListRow
  connect: string
}

/**
 * The join flow as a hook: validates the address, prompts for a password when the server needs
 * one, then calls `play()` with `+connect`/`userinfo` set - never argv, per
 * `src/shared/launch/userinfo.ts`'s own reasoning.
 *
 * The row is an argument of `start()` and is kept in state for the pending steps, so any caller can
 * pass any row. Render `dialogs` once next to the trigger.
 */
export function useJoinFlow(): {
  start: (row: ServerListRow) => void
  addressError: string | null
  dialogs: ReactNode
} {
  const { t } = useTranslation()
  const [addressError, setAddressError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [askPassword, setAskPassword] = useState(false)
  const [password, setPassword] = useState('')

  const closePassword = (): void => {
    setAskPassword(false)
    setPending(null)
    setPassword('')
  }

  const launch = (connect: string, userinfoPassword?: string): void => {
    void useLauncher.getState().play(undefined, {
      connect,
      userinfo: userinfoPassword ? { password: userinfoPassword } : undefined,
    })
  }

  const start = (row: ServerListRow): void => {
    setAddressError(null)
    const result = parseServerAddress(row.address)
    if (!result.ok) {
      setAddressError(t(serverAddressRejectionKey(result.reason)))
      return
    }
    const next: Pending = { row, connect: result.normalized }
    if (needsJoinPassword(row)) {
      setPending(next)
      setAskPassword(true)
      return
    }
    launch(next.connect)
  }

  const passwordValidation = parseUserinfoValue(password)
  const passwordError =
    password.length > 0 && !passwordValidation.ok
      ? t(userinfoRejectionKey(passwordValidation.reason))
      : null

  const submitPassword = (): void => {
    if (!pending || !passwordValidation.ok) return
    const connect = pending.connect
    const value = password
    closePassword()
    launch(connect, value)
  }

  const dialogs = (
    <>
      <Modal
        open={askPassword}
        size="sm"
        title={t('servers.join.password.title')}
        onClose={closePassword}
        closeLabel={t('common.action.close')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closePassword}
              data-testid="servers-join-password-cancel"
            >
              {t('common.action.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={submitPassword}
              disabled={!passwordValidation.ok}
              data-testid="servers-join-password-submit"
            >
              {t('common.action.join')}
            </Button>
          </>
        }
      >
        <div data-testid="servers-join-password">
          <Field label={t('common.label.password')} error={passwordError ?? undefined}>
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
    </>
  )

  return { start, addressError, dialogs }
}

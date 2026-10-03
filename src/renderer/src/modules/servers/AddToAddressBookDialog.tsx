import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { parseServerAddress, serverAddressRejectionKey } from '@shared/servers/address'
import { ok } from '@shared/types'
import { useModuleQuery } from '../../lib/useModuleQuery'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { Radio, RadioGroup } from '../../components/ui/RadioGroup'
import { useSubmitting } from '../../components/ui/useSubmitting'
import { useLauncher } from '../../store/useLauncher'
import { commitProfileCvars } from '../config/client'
import { useConfigProfiles } from '../config/config-profiles-store'
import {
  ADDRESS_BOOK_SLOTS,
  pickPreselectedProfileId,
  pickPreselectedSlot,
  readAddressBookSlots,
  type AddressBookSlot,
  type AddressBookSlotValue,
} from './lib/address-book'

/**
 * Story 127 D1: lets the user write a server's address into one of Quake II's nine `adr0`-`adr8`
 * cvars on a config profile of their choosing - the launcher-side counterpart of the engine's own
 * in-game address book.
 *
 * Mirrors `SetInstallationIconDialog`'s shell shape (own `pending`/`error` state, `Modal` with a
 * footer pair) but reads/writes through the config module's profile client instead of the
 * installations store. Profile list reads are fresh on open and on every profile switch; confirming
 * saves only the chosen slot through the config module's `commitCvars`, which does the
 * read-modify-write and conflict checks in main.
 */
export function AddToAddressBookDialog({
  open,
  address,
  onClose,
}: {
  open: boolean
  address: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const activeInstallationId = useLauncher((state) => state.settings.activeInstallationId)

  // `null` until this open's read answered; a failed read shows no profiles rather than a stale list.
  const storedProfiles = useConfigProfiles((state) => state.profiles)
  const [listState, setListState] = useState<'pending' | 'ready' | 'failed'>('pending')
  const profiles: ConfigProfile[] | null =
    listState === 'pending' ? null : listState === 'failed' ? [] : storedProfiles
  const [profileId, setProfileId] = useState<string | undefined>(undefined)
  const [slots, setSlots] = useState<AddressBookSlotValue[] | null>(null)
  const [slot, setSlot] = useState<AddressBookSlot | undefined>(undefined)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { submitting, run } = useSubmitting()

  // Initial load, on every open: fetch the profile list fresh and preselect profile + slot.
  const listQuery = useModuleQuery<ConfigProfile[] | null>(
    async () => (open ? useConfigProfiles.getState().load() : ok(null)),
    { deps: [open] },
  )
  useEffect(() => {
    if (!open) return
    setListState('pending')
    setSlots(null)
    setProfileId(undefined)
    setSlot(undefined)
    setError(null)
  }, [open])

  // Keyed on the query's value identity, so a stale value from the previous open is never applied.
  useEffect(() => {
    if (!open) return
    if (listQuery.state === 'error') {
      setError(listQuery.error?.key ?? null)
      setListState('failed')
      return
    }
    const list = listQuery.state === 'success' ? listQuery.data : null
    if (!list) return
    setListState('ready')
    const preselectedProfileId = pickPreselectedProfileId(list, activeInstallationId)
    setProfileId(preselectedProfileId)
    const preselectedProfile = list.find((p) => p.id === preselectedProfileId)
    const preselectedSlots = readAddressBookSlots(preselectedProfile?.cvars ?? {})
    setSlots(preselectedSlots)
    setSlot(pickPreselectedSlot(preselectedSlots, address))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- preselection runs per delivered list only
  }, [listQuery.state, listQuery.data])

  // Story AC5: switching profiles re-reads fresh rather than trusting the list already in state -
  // guards against another surface (or another window) having changed the profile's cvars in the
  // meantime. While the read is in flight, `slots` is cleared so no stale value from the previous
  // profile is shown.
  const onSwitchProfile = (nextProfileId: string): void => {
    setProfileId(nextProfileId)
    setSlots(null)
    setSlot(undefined)
    setLoadingSlots(true)
    void (async () => {
      const result = await useConfigProfiles.getState().load()
      if (!result.ok) {
        setError(result.error.key)
        setLoadingSlots(false)
        return
      }
      setListState('ready')
      const freshProfile = result.value.find((p) => p.id === nextProfileId)
      const freshSlots = readAddressBookSlots(freshProfile?.cvars ?? {})
      setSlots(freshSlots)
      setSlot(pickPreselectedSlot(freshSlots, address))
      setLoadingSlots(false)
    })()
  }

  const addressResult = parseServerAddress(address)

  const canConfirm =
    !submitting &&
    profileId !== undefined &&
    slot !== undefined &&
    addressResult.ok &&
    (profiles?.length ?? 0) > 0

  const handleConfirm = (): Promise<void | undefined> => {
    if (!canConfirm || !addressResult.ok || profileId === undefined || slot === undefined) {
      return Promise.resolve(undefined)
    }
    return run(async () => {
      setError(null)
      const result = await commitProfileCvars({
        profileId,
        cvars: { [slot]: addressResult.normalized },
      })

      if (!result.ok) {
        setError(result.error.key)
        return
      }

      useConfigProfiles.getState().upsert(result.value)
      pushToast({
        level: 'success',
        messageKey: 'servers.addressBook.saved',
        timeoutMs: 4000,
        params: { profile: result.value.name, slot },
      })
      onClose()
    })
  }

  const noProfiles = profiles !== null && profiles.length === 0

  return (
    <Modal
      open={open}
      size="sm"
      title={t('servers.addressBook.title')}
      description={t('servers.addressBook.description')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('servers.addressBook.cancel')}
          </Button>
          <Button
            variant="primary"
            data-testid="servers-address-book-confirm"
            disabled={!canConfirm}
            onClick={() => void handleConfirm()}
          >
            {t('servers.addressBook.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t(error)}
          </p>
        )}

        {!addressResult.ok && (
          <p className="text-xs leading-relaxed text-danger">
            {t(serverAddressRejectionKey(addressResult.reason))}
          </p>
        )}

        {noProfiles ? (
          <p className="text-xs leading-relaxed text-ink-dim">
            {t('servers.addressBook.noProfiles')}
          </p>
        ) : (
          <>
            <label className="block space-y-1.5" data-testid="servers-address-book-profile">
              <span className="stencil block">{t('servers.addressBook.profileLabel')}</span>
              <Select
                value={profileId ?? ''}
                disabled={!profiles}
                onChange={(event) => onSwitchProfile(event.target.value)}
                options={(profiles ?? []).map((profile) => ({
                  value: profile.id,
                  label: profile.name,
                }))}
              />
            </label>

            <div className="space-y-2">
              <span className="stencil block">{t('servers.addressBook.slotLabel')}</span>
              {loadingSlots || slots === null ? (
                <p className="text-xs leading-relaxed text-ink-dim">
                  {t('servers.addressBook.loading')}
                </p>
              ) : (
                <RadioGroup
                  name="address-book-slot"
                  value={slot ?? ''}
                  onChange={(value) => setSlot(value as AddressBookSlot)}
                  label={t('servers.addressBook.slotLabel')}
                >
                  {ADDRESS_BOOK_SLOTS.map((slotName, index) => {
                    const entry = slots.find((s) => s.slot === slotName)
                    return (
                      <div key={slotName} data-testid={`servers-address-book-slot-${index}`}>
                        <Radio
                          value={slotName}
                          label={
                            <>
                              <span className="text-ink">{slotName}</span>
                              <span>
                                {entry?.value
                                  ? slot === slotName
                                    ? t('servers.addressBook.replaces', { value: entry.value })
                                    : entry.value
                                  : t('servers.addressBook.slotEmpty')}
                              </span>
                            </>
                          }
                        />
                      </div>
                    )
                  })}
                </RadioGroup>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

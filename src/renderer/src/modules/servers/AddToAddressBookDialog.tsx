import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import { parseServerAddress, serverAddressRejectionKey } from '@shared/servers/address'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { useLauncher } from '../../store/useLauncher'
import { listConfigProfiles, updateProfileCvars } from '../config/client'
import {
  ADDRESS_BOOK_SLOTS,
  buildAddressBookCvars,
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
 * installations store. Every profile list read is fresh (AC5: switching profiles, and confirming,
 * never trust a value read before the switch) - `listConfigProfiles()` is called again on open, on
 * every profile switch, and again right before the write, rather than caching one snapshot for the
 * whole dialog lifetime.
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

  const [profiles, setProfiles] = useState<ConfigProfile[] | null>(null)
  const [profileId, setProfileId] = useState<string | undefined>(undefined)
  const [slots, setSlots] = useState<AddressBookSlotValue[] | null>(null)
  const [slot, setSlot] = useState<AddressBookSlot | undefined>(undefined)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Initial load, on every open: fetch the profile list fresh and preselect profile + slot.
  useEffect(() => {
    if (!open) return
    setProfiles(null)
    setSlots(null)
    setProfileId(undefined)
    setSlot(undefined)
    setError(null)

    let cancelled = false
    void (async () => {
      const result = await listConfigProfiles()
      if (cancelled) return
      if (!result.ok) {
        setError(result.error.key)
        setProfiles([])
        return
      }
      setProfiles(result.value)
      const preselectedProfileId = pickPreselectedProfileId(result.value, activeInstallationId)
      setProfileId(preselectedProfileId)
      const preselectedProfile = result.value.find((p) => p.id === preselectedProfileId)
      const preselectedSlots = readAddressBookSlots(preselectedProfile?.cvars ?? {})
      setSlots(preselectedSlots)
      setSlot(pickPreselectedSlot(preselectedSlots, address))
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
      const result = await listConfigProfiles()
      if (!result.ok) {
        setError(result.error.key)
        setLoadingSlots(false)
        return
      }
      setProfiles(result.value)
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

  const handleConfirm = async (): Promise<void> => {
    if (!canConfirm || !addressResult.ok || profileId === undefined || slot === undefined) return
    setSubmitting(true)
    setError(null)

    const freshResult = await listConfigProfiles()
    if (!freshResult.ok) {
      setError(freshResult.error.key)
      setSubmitting(false)
      return
    }
    const freshProfile = freshResult.value.find((p) => p.id === profileId)
    if (!freshProfile) {
      setError('servers.addressBook.noProfiles')
      setSubmitting(false)
      return
    }

    const result = await updateProfileCvars({
      profileId,
      cvars: buildAddressBookCvars(freshProfile.cvars, slot, addressResult.normalized),
    })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.key)
      return
    }

    pushToast({
      level: 'success',
      messageKey: 'servers.addressBook.written',
      timeoutMs: 4000,
      params: { profile: freshProfile.name, slot },
    })
    onClose()
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
          <p className="text-xs leading-relaxed text-ink-dim">{t('servers.addressBook.noProfiles')}</p>
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
                <div className="space-y-1.5 text-sm text-ink">
                  {ADDRESS_BOOK_SLOTS.map((slotName, index) => {
                    const entry = slots.find((s) => s.slot === slotName)
                    return (
                      <label
                        key={slotName}
                        className="flex cursor-pointer items-center gap-2"
                        data-testid={`servers-address-book-slot-${index}`}
                      >
                        <input
                          type="radio"
                          name="address-book-slot"
                          className="accent-flame-500"
                          checked={slot === slotName}
                          onChange={() => setSlot(slotName)}
                        />
                        <span>{slotName}</span>
                        <span className="text-ink-dim">
                          {entry?.value
                            ? slot === slotName
                              ? t('servers.addressBook.replaces', { value: entry.value })
                              : entry.value
                            : t('servers.addressBook.slotEmpty')}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

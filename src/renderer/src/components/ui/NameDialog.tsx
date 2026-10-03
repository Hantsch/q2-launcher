import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Field, Input } from './controls'
import { Modal } from './Modal'
import { useSubmitting } from './useSubmitting'

export interface NameDialogProps {
  titleKey: string
  labelKey: string
  initialName: string
  maxLength?: number
  /** Returns an i18n key describing why the trimmed name is unacceptable, or null. */
  validate?: (trimmed: string) => string | null
  onSubmit: (trimmed: string) => Promise<unknown> | unknown
  onClose: () => void
  /** Rendered below the name field. The function form receives the dialog's own gated submit, so
   * an extra field can submit on Enter through the same `canSubmit` as the name field. */
  children?: ReactNode | ((submit: () => void) => ReactNode)
  submitLabelKey?: string
  /** A refusal from main, already translated. */
  error?: string
  description?: string
  placeholder?: string
  /** Hides the field and lets the submit go through without a name. */
  nameOptional?: boolean
  /** Extra gate on the trimmed name for rules that need no message of their own (e.g. unchanged). */
  submittable?: (trimmed: string) => boolean
  /** Fires on every edit with the raw (untrimmed) value. */
  onNameChange?: (name: string) => void
  /** Static text shown right of the field. */
  suffix?: ReactNode
  /** `error` renders as its own alert paragraph (outside the field) when `testIds.error` is set. */
  testIds?: { input?: string; submit?: string; cancel?: string; error?: string; dialog?: string }
}

/** Asks for one name. The caller closes the dialog once `onSubmit` has succeeded. */
export function NameDialog({
  titleKey,
  labelKey,
  initialName,
  maxLength,
  validate,
  onSubmit,
  onClose,
  children,
  submitLabelKey = 'common.save',
  error,
  description,
  placeholder,
  nameOptional = false,
  submittable,
  onNameChange,
  suffix,
  testIds,
}: NameDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const { submitting, run } = useSubmitting()

  const trimmed = name.trim()
  const validationKey = trimmed.length > 0 ? (validate?.(trimmed) ?? null) : null
  // The single gate for both the button and the Enter key.
  const canSubmit =
    (nameOptional || trimmed.length > 0) &&
    !validationKey &&
    (submittable?.(trimmed) ?? true) &&
    !submitting

  const submit = (): void => {
    if (canSubmit) void run(() => onSubmit(trimmed))
  }

  return (
    <Modal
      open
      size="sm"
      title={t(titleKey)}
      description={description}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-testid={testIds?.cancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={submit}
            data-testid={testIds?.submit}
          >
            {t(submitLabelKey)}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid={testIds?.dialog}>
        {!nameOptional && (
          <Field
            label={t(labelKey)}
            error={validationKey ? t(validationKey) : testIds?.error ? undefined : error}
          >
            <div className="flex items-center gap-2">
              <Input
                value={name}
                placeholder={placeholder}
                autoFocus
                maxLength={maxLength}
                data-testid={testIds?.input}
                onChange={(event) => {
                  setName(event.target.value)
                  onNameChange?.(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit()
                }}
              />
              {suffix !== undefined && <span className="text-ink-muted">{suffix}</span>}
            </div>
          </Field>
        )}
        {testIds?.error && error && !validationKey && (
          <p className="text-xs text-danger" role="alert" data-testid={testIds.error}>
            {error}
          </p>
        )}
        {typeof children === 'function' ? children(submit) : children}
      </div>
    </Modal>
  )
}

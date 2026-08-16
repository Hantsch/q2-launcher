import { useTranslation } from 'react-i18next'
import { Q2_GLYPHS } from '@shared/config/q2-charset'
import { Button } from '../../../components/ui/Button'

/**
 * Story 008 D8: the symbol/colour picker for `MessageEditor`. No image
 * assets (CLAUDE.md) - each glyph renders as its ASCII stand-in plus its byte
 * value, never a rendered conchars preview (upstream's doc comment promised
 * one; no such code ever existed there, per decision 21).
 *
 * `onInsertGlyph` inserts one high-bit byte at the caret; `onApplyAltCharset`
 * runs `toAltCharset`/`fromAltCharset` over the caller's current text
 * selection (this component holds no text state itself - the caller owns the
 * caret/selection, since it also owns the input the caret lives in).
 */
export function SymbolPicker({
  onInsertGlyph,
  onApplyAltCharset,
  hasSelection,
}: {
  onInsertGlyph: (char: string) => void
  onApplyAltCharset: () => void
  hasSelection: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="stencil">{t('config.advanced.messageEditor.symbolPicker.label')}</span>
        <Button variant="neutral" size="sm" disabled={!hasSelection} onClick={onApplyAltCharset}>
          {t('config.advanced.messageEditor.symbolPicker.applyAltCharset')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Q2_GLYPHS.map((glyph) => {
          const hex = `0x${glyph.byte.toString(16).padStart(2, '0')}`
          return (
            <button
              key={glyph.byte}
              type="button"
              title={`${t(glyph.labelKey)} (${hex})`}
              onClick={() => onInsertGlyph(String.fromCharCode(glyph.byte))}
              className="flex min-w-9 flex-col items-center gap-0.5 rounded-sm border border-line px-1.5 py-1 text-xs text-ink transition-colors duration-[--dur-fast] hover:bg-hover"
            >
              <span className="text-sm leading-none">{glyph.ascii}</span>
              <span className="numeric text-[9px] leading-none text-ink-muted">{hex}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

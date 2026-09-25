import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { buildRuleTable, type KnownRuleRow, type RawRuleRow, type RuleValue } from '@shared/servers/rule-table'
import type { DmflagId } from '@shared/servers/dmflags'
import { EmptyState } from '../../components/ui/primitives'

export interface ServerRulesPanelProps {
  serverinfo: Record<string, string> | undefined
}

/** Formats one seconds count as `h:mm:ss` - never throws on a negative/huge/non-finite value, since
 * `duration.seconds` ultimately comes off the wire via `rule-table.ts`'s own numeric parsing. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return String(seconds)
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}`
}

function formatProtocol(value: RuleValue & { kind: 'protocol' }, t: TFunction): string {
  if (value.engine === undefined) return String(value.value)
  const engineLabel = t(`servers.engine.${value.engine}`)
  return `${value.value} (${engineLabel})`
}

function formatKnownValue(value: RuleValue, t: TFunction): string {
  switch (value.kind) {
    case 'text':
      return value.value
    case 'int':
      return String(value.value)
    case 'protocol':
      return formatProtocol(value, t)
    case 'needpass':
      return t('servers.detail.rules.needpass.value', {
        password: t(value.password ? 'servers.detail.rules.yes' : 'servers.detail.rules.no'),
        spectatorPassword: t(
          value.spectatorPassword ? 'servers.detail.rules.yes' : 'servers.detail.rules.no',
        ),
      })
    case 'flag':
      return t(value.on ? 'servers.detail.rules.on' : 'servers.detail.rules.off')
    case 'limit':
      return value.value === 0 ? t('servers.detail.rules.limit.none') : String(value.value)
    case 'minutes':
      return value.value === 0
        ? t('servers.detail.rules.minutes.none')
        : t('servers.detail.rules.minutes.value', { count: value.value })
    case 'duration':
      return formatDuration(value.seconds)
    case 'dmflags':
      return String(value.value)
    case 'unparsed':
      return value.raw
    default:
      return ''
  }
}

function KnownRow({ row, t }: { row: KnownRuleRow; t: TFunction }) {
  let display: string
  let failed = false
  try {
    display = formatKnownValue(row.value, t)
  } catch {
    display = ''
    failed = true
  }

  return (
    <div
      className="flex min-w-0 items-baseline justify-between gap-3 py-0.5"
      data-testid="rule-row"
      data-key={row.key}
    >
      <span className="stencil shrink-0">{t(`servers.detail.rules.key.${row.key}`)}</span>
      <span className="min-w-0 truncate text-right text-xs text-ink-dim">
        {failed || row.value.kind === 'unparsed' ? (
          <>
            {row.value.kind === 'unparsed' ? row.value.raw : ''}
            {' '}
            <span className="text-ink-muted">{t('servers.detail.rules.unparsed')}</span>
          </>
        ) : (
          display
        )}
      </span>
    </div>
  )
}

function RawRow({ row, t }: { row: RawRuleRow; t: TFunction }) {
  return (
    <div
      className="flex min-w-0 items-baseline justify-between gap-3 py-0.5"
      data-testid="rule-row"
      data-key={row.key}
    >
      <span className="numeric shrink-0 text-xs text-ink-muted">{row.key}</span>
      <span className="numeric min-w-0 truncate text-right text-xs text-ink-dim">
        {row.value === '' ? t('servers.detail.rules.emptyValue') : row.value}
      </span>
    </div>
  )
}

const DMFLAG_LABEL_KEY: Record<DmflagId, string> = {
  'no-health': 'noHealth',
  'no-items': 'noItems',
  'weapons-stay': 'weaponsStay',
  'no-falling': 'noFalling',
  'instant-items': 'instantItems',
  'same-level': 'sameLevel',
  'skin-teams': 'skinTeams',
  'model-teams': 'modelTeams',
  'no-friendly-fire': 'noFriendlyFire',
  'spawn-farthest': 'spawnFarthest',
  'force-respawn': 'forceRespawn',
  'no-armor': 'noArmor',
  'allow-exit': 'allowExit',
  'infinite-ammo': 'infiniteAmmo',
  'quad-drop': 'quadDrop',
  'fixed-fov': 'fixedFov',
}

/**
 * Story 123 D3: the detail pane's "rules a server plays by" section - built entirely out of the
 * shared, pure `buildRuleTable`/`decodeDmflags` parsers (no re-parsing here), rendering three
 * subsections (known, raw, dmflags) that each degrade independently: a single malformed value never
 * blanks the whole panel, mirroring `ServerPlayersPanel.tsx`'s per-row defensiveness.
 */
export function ServerRulesPanel({ serverinfo }: ServerRulesPanelProps) {
  const { t } = useTranslation()

  if (serverinfo === undefined) {
    return (
      <div data-testid="servers-detail-rules">
        <h3 className="stencil mb-2">{t('servers.detail.rules.title')}</h3>
        <EmptyState title={t('servers.detail.rules.empty')} />
      </div>
    )
  }

  const table = buildRuleTable(serverinfo)

  return (
    <div data-testid="servers-detail-rules">
      <h3 className="stencil mb-2">{t('servers.detail.rules.title')}</h3>

      <div data-testid="rules-known" className="space-y-0.5">
        {table.known.map((row) => (
          <KnownRow key={row.key} row={row} t={t} />
        ))}
      </div>

      {table.raw.length > 0 && (
        <div className="mt-3">
          <h4 className="stencil mb-1">{t('servers.detail.rules.rawTitle')}</h4>
          <div data-testid="rules-raw" className="space-y-0.5">
            {table.raw.map((row) => (
              <RawRow key={row.key} row={row} t={t} />
            ))}
          </div>
        </div>
      )}

      {table.dmflags && (
        <div className="mt-3" data-testid="rules-dmflags">
          <h4 className="stencil mb-1">{t('servers.detail.rules.dmflags.title')}</h4>
          <p className="text-xs text-ink-muted">{t('servers.detail.rules.dmflags.caveat')}</p>
          <DmflagsBody dmflags={table.dmflags} t={t} />
        </div>
      )}
    </div>
  )
}

function DmflagsBody({
  dmflags,
  t,
}: {
  dmflags: NonNullable<ReturnType<typeof buildRuleTable>['dmflags']>
  t: TFunction
}) {
  const { decoded } = dmflags

  if (!decoded.ok) {
    return (
      <p className="text-xs text-ink-dim">
        {decoded.raw} <span className="text-ink-muted">{t('servers.detail.rules.unparsed')}</span>
      </p>
    )
  }

  if (decoded.rules.length === 0 && decoded.unknownBits.length === 0) {
    return <p className="text-xs text-ink-dim">{t('servers.detail.rules.dmflags.none')}</p>
  }

  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-dim">
      {decoded.rules.map((id) => (
        <li key={id}>{t(`servers.detail.rules.dmflags.rule.${DMFLAG_LABEL_KEY[id]}`)}</li>
      ))}
      {decoded.unknownBits.map((bit) => (
        <li key={`unknown-${bit}`}>{t('servers.detail.rules.dmflags.unknownBit', { bit })}</li>
      ))}
    </ul>
  )
}

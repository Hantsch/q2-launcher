import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { RttSample, ServerListEntry } from '@shared/modules/servers'

export interface ServerReachabilitySectionProps {
  entry: ServerListEntry
}

/** Formats an ISO timestamp as a locale time string - never throws on a missing/unparsable value,
 * returning `null` so the caller can omit the line entirely rather than show "Invalid Date". */
function formatTime(at: string | null | undefined): string | null {
  if (!at) return null
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString()
}

function SampleLine({ sample, t }: { sample: RttSample; t: TFunction }) {
  const time = formatTime(sample.at)
  const atIsValid = time !== null
  let text: string
  if (!atIsValid || (sample.rttMs !== null && !Number.isFinite(sample.rttMs))) {
    text = t('servers.detail.reachability.sample.unknown')
  } else if (sample.rttMs === null) {
    text = t('servers.detail.reachability.sample.noAnswer')
  } else {
    text = t('servers.detail.reachability.sample.ms', { ms: sample.rttMs })
  }

  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 py-0.5" data-testid="server-reachability-sample">
      <span className="min-w-0 truncate text-xs text-ink-dim">{text}</span>
      {time !== null && <span className="shrink-0 text-xs text-ink-muted">{time}</span>}
    </div>
  )
}

/**
 * Story 124 D2: the detail pane's "how this server has answered" section - built from
 * `ServerListEntry.status`/`lastSeenAt`/`rttHistory`, all already maintained by the scan service
 * (never re-derived here). History is rendered newest first without mutating `entry.rttHistory`
 * (oldest-first is the storage order, `RTT_HISTORY_LIMIT`-capped by `scan-merge.ts`). Every line
 * degrades independently - a single malformed sample never blanks the others, mirroring
 * `ServerRulesPanel.tsx`'s/`ServerPlayersPanel.tsx`'s per-row defensiveness. Plain text only, no
 * colour-only status indication (`/design-tokens`).
 */
export function ServerReachabilitySection({ entry }: ServerReachabilitySectionProps) {
  const { t } = useTranslation()

  const lastAnsweredTime = entry.status === 'stale' ? formatTime(entry.lastSeenAt) : null
  const history = entry.rttHistory ?? []
  const newestFirst = [...history].reverse()

  return (
    <div data-testid="server-reachability">
      <h3 className="stencil mb-2">{t('servers.detail.reachability.title')}</h3>

      <div data-testid="server-reachability-last-round" className="mb-2 text-xs text-ink-dim">
        <p>
          {entry.status === 'online'
            ? t('servers.detail.reachability.lastRound.answered')
            : t('servers.detail.reachability.lastRound.noAnswer')}
        </p>
        {lastAnsweredTime !== null && (
          <p>{t('servers.detail.reachability.lastAnswered', { time: lastAnsweredTime })}</p>
        )}
      </div>

      {newestFirst.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('servers.detail.reachability.empty')}</p>
      ) : (
        <div className="space-y-0.5">
          {newestFirst.map((sample, index) => (
            <SampleLine key={`${sample.at}-${index}`} sample={sample} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

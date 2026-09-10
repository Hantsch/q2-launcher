import { useTranslation } from 'react-i18next'
import { Panel } from '../../components/ui/primitives'

/**
 * The home module's screen.
 *
 * Deliberately near-empty: story 081 moved the home route out of the shell and
 * deleted the dead hero and the planned-module card grid that used to sit here,
 * so what is left is one placeholder block - a title and a one-sentence lead.
 * The news hero (082/083) and the dashboard (086) fill this container; nothing
 * is scaffolded ahead of those stories.
 */
export function HomeView() {
  const { t } = useTranslation()

  return (
    <div className="h-full overflow-y-auto p-4 scrollbar-gutter-stable">
      <div className="mx-auto max-w-2xl space-y-4 py-8">
        <Panel className="space-y-2 p-4">
          <h1 className="font-display text-xl tracking-[0.06em] text-ink uppercase">
            {t('home.title')}
          </h1>
          <p className="text-sm leading-relaxed text-ink-dim">{t('home.lead')}</p>
        </Panel>
      </div>
    </div>
  )
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Fonts are bundled, never fetched: the launcher has to look right offline and
// the CSP forbids remote origins.
import '@fontsource-variable/inter'
import '@fontsource-variable/oswald'
import '@fontsource-variable/jetbrains-mono'

import './styles/index.css'
import { App } from './App'
import { initI18n } from './i18n'
import { invoke } from './lib/bridge'

/**
 * Boot order matters: the locale has to be known before the first render,
 * otherwise every label flashes its key. So we ask main for the settings, start
 * i18next, and only then mount.
 */
async function start(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('#root is missing from index.html')

  const settings = await invoke('settings:get')
  await initI18n(settings.locale)

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()

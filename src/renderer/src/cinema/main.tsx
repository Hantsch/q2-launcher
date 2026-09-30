import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../styles/index.css'
import './cinema.css'
import { initI18n } from '../i18n'
import { invoke } from '../lib/bridge'
import { CinemaOverlay } from '../modules/replays/cinema/CinemaOverlay'

async function start(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('#root is missing from cinema.html')

  const settings = await invoke('settings:get')
  await initI18n(settings.locale)

  createRoot(container).render(
    <StrictMode>
      <CinemaOverlay />
    </StrictMode>,
  )
}

void start()

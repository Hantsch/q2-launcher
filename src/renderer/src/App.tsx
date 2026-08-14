import { useEffect } from 'react'
import { Q2Mark } from './components/brand/Q2Mark'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppShell } from './components/shell/AppShell'
import { useLauncher } from './store/useLauncher'

export function App() {
  const ready = useLauncher((state) => state.ready)
  const bootstrap = useLauncher((state) => state.bootstrap)
  const motion = useLauncher((state) => state.settings.motion)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // The CSS reads this to override the OS motion preference in either direction.
  useEffect(() => {
    if (motion === 'system') delete document.documentElement.dataset['motion']
    else document.documentElement.dataset['motion'] = motion
  }, [motion])

  if (!ready) return <BootSplash />

  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  )
}

/**
 * Shown for the few frames between the window appearing and main answering the
 * first batch of IPC calls. Same background as the shell, so there is no flash.
 */
function BootSplash() {
  return (
    <div className="app-backdrop grid h-full place-items-center">
      <div className="flex flex-col items-center gap-3">
        <Q2Mark className="animate-pulse text-flame-600" size={40} />
        <div className="stencil tracking-[0.3em]">Quake II</div>
      </div>
    </div>
  )
}

import type { ReactElement } from 'react'
import type { ModuleManifest } from '@shared/types'
import { ROUTE_HOME, ROUTE_SETTINGS, useLauncher } from '../../store/useLauncher'
import { rendererModule } from '../../modules'
import { PlannedModuleView } from '../../views/PlannedModuleView'
import { SettingsView } from '../../views/SettingsView'
import { Dialogs } from '../installations/Dialogs'
import { Toasts } from '../ui/Toasts'
import { ActionBar } from './ActionBar'
import { InstallationRail } from './InstallationRail'
import { TitleBar } from './TitleBar'

/**
 * The shell: chrome on top, installation rail on the left, the active view in
 * the middle, the action bar at the bottom.
 *
 * The three fixed zones are always present, so switching modules never moves the
 * play button or the installation strip. Only the middle pane changes.
 */
export function AppShell() {
  const route = useLauncher((state) => state.route)
  const modules = useLauncher((state) => state.modules)

  return (
    <div className="app-backdrop flex h-full flex-col overflow-hidden">
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <InstallationRail />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {resolveView(route, modules)}
        </main>
      </div>

      <ActionBar />

      <Toasts />
      <Dialogs />
    </div>
  )
}

/**
 * Route resolution.
 *
 * A module route renders the module's registered view, or the planned-module
 * placeholder if only the manifest exists. Deliberately a plain function rather
 * than a router: there are a handful of top-level destinations, no URLs, no
 * nesting and no history to speak of - a router would be more moving parts for
 * no gain. If deep links (`quake2launcher://...`) arrive later, this is the one
 * place that has to change.
 *
 * Settings is the only screen the shell still owns. Home is a module route like
 * any other (story 081), which is also why an unknown route - a persisted
 * `lastRoute` naming a since-renamed module, say - lands on home through the same
 * manifest lookup instead of a shell-owned home component.
 */
export function resolveView(route: string, modules: ModuleManifest[]): ReactElement {
  if (route === ROUTE_SETTINGS) return <SettingsView />

  return moduleView(route, modules) ?? moduleView(ROUTE_HOME, modules) ?? <></>
}

/**
 * The view for a module route, or `undefined` when no manifest claims that route -
 * which is what lets the caller fall through to home.
 *
 * A manifest without a registered renderer half still resolves, to
 * `PlannedModuleView`: a parked module is a real screen, not a dead link. The
 * empty fragment `resolveView` ends on is only reachable if the manifest list
 * itself lacks home, which cannot happen at runtime (the shell renders after
 * `modules:list` has answered from `MODULE_MANIFESTS`).
 */
function moduleView(route: string, modules: ModuleManifest[]): ReactElement | undefined {
  const manifest = modules.find((module) => module.route === route)
  if (!manifest) return undefined

  const View = rendererModule(manifest.id)?.View
  if (View) return <View />

  return <PlannedModuleView module={manifest} />
}

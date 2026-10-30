import { InstallationsService, type InstallationsDeps } from '../main/services/installations'

/**
 * An `InstallationsService` over the given state with inert callbacks. The two path anchors are
 * required by the service; the defaults point at a directory that never exists, so a test that
 * reaches the disk-deletion path must supply real ones. (story 322)
 */
export function makeInstallationsService(
  overrides: Pick<InstallationsDeps, 'state'> & Partial<InstallationsDeps>,
): InstallationsService {
  return new InstallationsService({
    onChange: () => {},
    onSettingsChange: () => {},
    userDataDir: '/no-such-user-data',
    homeDir: '/no-such-home',
    ...overrides,
  })
}

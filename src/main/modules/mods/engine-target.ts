import type { EngineKind } from '@shared/types/engine'
import type { ModsErrorKey } from '@shared/modules/mods'
import type { Installation } from '@shared/types/installation'
import type { BinaryArch } from '../../lib/fs-utils'
import { readEngineState } from '../../services/engine-state'
import type { ModCatalogEntryParsed } from './catalog-schema'

/** What a mod variant has to match: the platform and CPU architecture of the installation's engine. */
export interface EngineTarget {
  platform: 'win32' | 'linux'
  arch: BinaryArch
  engineKind: EngineKind
}

type EnginePackageLike = { id: string; kind: string; arch?: 'x86' | 'x86_64' }
type CatalogVersion = ModCatalogEntryParsed['versions'][number]
type CatalogVariant = CatalogVersion['variants'][number]

export type VariantSelection =
  | { variant: CatalogVariant | CatalogVersion['contentOnly']; contentOnly: boolean }
  | { refused: Extract<ModsErrorKey, 'mods.error.noVariant'> }

/**
 * The manifest package the installation was installed from knows its arch; otherwise the
 * executable's own header does. Platform follows the executable's format, falling back to the host.
 */
export async function resolveEngineTarget(
  installation: Pick<
    Installation,
    'engineKind' | 'executablePath' | 'executableKind' | 'moduleData'
  >,
  enginePackages: readonly EnginePackageLike[],
  readArch: (path: string) => Promise<BinaryArch>,
): Promise<EngineTarget> {
  const { packageId } = readEngineState(installation.moduleData)
  const pkg = packageId
    ? enginePackages.find((p) => p.kind === 'engine' && p.id === packageId)
    : undefined
  let arch: BinaryArch = pkg?.arch ?? 'unknown'
  if (!pkg?.arch) {
    arch = installation.executablePath ? await readArch(installation.executablePath) : 'unknown'
  }
  const platform =
    installation.executableKind === 'pe'
      ? 'win32'
      : installation.executableKind === 'elf'
        ? 'linux'
        : process.platform === 'win32'
          ? 'win32'
          : 'linux'
  return { platform, arch, engineKind: installation.engineKind }
}

/** The catalog spells 64-bit `x64`; the engine target spells it `x86_64`. */
function targetArchMatches(variantArch: CatalogVariant['arch'], target: BinaryArch): boolean {
  if (target === 'unknown') return false
  return (
    (target === 'x86_64' && variantArch === 'x64') || (target === 'x86' && variantArch === 'x86')
  )
}

/**
 * A library variant only when its platform and arch equal the target; otherwise the version's
 * content-only package set (usable when it has packages), else the install is refused.
 */
export function selectVariant(
  entryVersion: CatalogVersion,
  target: EngineTarget,
): VariantSelection {
  const library = entryVersion.variants.find(
    (v) =>
      v.platform === target.platform &&
      targetArchMatches(v.arch, target.arch) &&
      v.packages.length > 0,
  )
  if (library) return { variant: library, contentOnly: false }
  if (entryVersion.contentOnly.packages.length > 0) {
    return { variant: entryVersion.contentOnly, contentOnly: true }
  }
  return { refused: 'mods.error.noVariant' }
}

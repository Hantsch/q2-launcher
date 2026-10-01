import { engineLabel, type EngineKind } from '@shared/types/engine'

/** "Q2PRO 64-bit": the engine's display name plus its pointer width when the arch is known. */
export function engineWithArch(kind: EngineKind | undefined, arch: string | undefined): string {
  const name = engineLabel(kind ?? 'unknown')
  if (arch === 'x86') return `${name} 32-bit`
  if (arch === 'x64' || arch === 'x86_64') return `${name} 64-bit`
  return name // 'unknown' and anything else: no bitness is claimed
}

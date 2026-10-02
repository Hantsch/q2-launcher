/**
 * Decodes image bytes with Electron's `nativeImage`, imported lazily so that importing this module
 * (and running tests that inject their own decoder) needs no Electron runtime - the same reason
 * `lib/net/fetcher.ts` imports `electron` lazily. This is a shell-owned lib wrapper (like `lib/paths.ts`
 * and `lib/net/fetcher.ts`): modules never import `electron` themselves. (story 209)
 */
export async function decodeImageWithElectron(
  bytes: Buffer,
): Promise<{ ok: boolean; width?: number; height?: number }> {
  const { nativeImage } = await import('electron')
  try {
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return { ok: false }
    const { width, height } = image.getSize()
    return { ok: true, width, height }
  } catch {
    return { ok: false }
  }
}

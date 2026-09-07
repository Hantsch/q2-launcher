/**
 * The shipped installation-icon set.
 *
 * The manifest is discovered from disk with `import.meta.glob`, never listed
 * literally — adding, removing or renaming a file in
 * `src/renderer/src/assets/installations/` is the whole edit. No component
 * may hardcode an icon id or filename (see AC1 of story 067).
 */
const modules = import.meta.glob('../assets/installations/*.avif', {
  eager: true,
  import: 'default',
}) as Record<string, string>

export interface ShippedIcon {
  id: string
  url: string
}

function idFromPath(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.avif$/, '')
}

export const SHIPPED_ICONS: ShippedIcon[] = Object.entries(modules)
  .map(([path, url]) => ({ id: idFromPath(path), url }))
  .sort((a, b) => a.id.localeCompare(b.id))

export function shippedIconUrl(id: string): string | undefined {
  return SHIPPED_ICONS.find((icon) => icon.id === id)?.url
}

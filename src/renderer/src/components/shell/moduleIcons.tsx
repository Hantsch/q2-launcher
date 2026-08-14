import {
  Boxes,
  CircleHelp,
  Download,
  Images,
  LayoutGrid,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'

/**
 * Manifest icon names resolved to components.
 *
 * An explicit map instead of a dynamic `lucide-react` lookup: it keeps the
 * bundle to the icons we actually use, and an unknown name degrades to a
 * placeholder rather than crashing the shell.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutGrid,
  Download,
  SlidersHorizontal,
  Boxes,
  Images,
}

export function moduleIcon(name: string): LucideIcon {
  return ICONS[name] ?? CircleHelp
}

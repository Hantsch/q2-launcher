import type { ReplaysStageRect } from '@shared/modules/replays'

/**
 * Story 170 D1: pure helpers for playing a demo on the launcher's stage - whether the platform can
 * place another process's window at all, the physical geometry of the stage rect, and the engine
 * arguments that make the game window borderless at that spot. No electron import: the display
 * conversion (`screen.dipToScreenRect`) is injected.
 */

export type StageAvailability =
  | { available: true }
  | { available: false; reason: { key: 'replays.stage.unavailable.wayland' } }

const WAYLAND_UNAVAILABLE = {
  available: false,
  reason: { key: 'replays.stage.unavailable.wayland' },
} as const

/**
 * A Wayland session cannot have its clients positioned, so the stage is unavailable there.
 * `Q2L_UI_SESSION_TYPE=wayland` forces that on any platform for the UI harness - honoured only
 * with `Q2L_UI_HARNESS` set, like `Q2L_UI_PICK_FILES` in `services/dialog.ts`.
 */
export function stageAvailability(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  harnessEnv: Record<string, string | undefined> = {},
): StageAvailability {
  if (harnessEnv['Q2L_UI_HARNESS'] && harnessEnv['Q2L_UI_SESSION_TYPE'] === 'wayland') return WAYLAND_UNAVAILABLE
  if (platform === 'linux' && (env['XDG_SESSION_TYPE'] === 'wayland' || (env['WAYLAND_DISPLAY'] ?? '') !== '')) {
    return WAYLAND_UNAVAILABLE
  }
  return { available: true }
}

export interface StageRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The stage rect (CSS px of the content area) as the engine's `vid_geometry` 'WxH+X+Y' in physical
 * pixels: content origin + css * zoom gives DIPs, `dipToScreen` converts to physical, then rounded.
 */
export function stageGeometry(
  cssRect: ReplaysStageRect,
  view: { contentBounds: { x: number; y: number }; zoomFactor: number },
  dipToScreen: (dip: StageRect) => StageRect,
): string {
  const { contentBounds, zoomFactor } = view
  const physical = dipToScreen({
    x: contentBounds.x + cssRect.x * zoomFactor,
    y: contentBounds.y + cssRect.y * zoomFactor,
    width: cssRect.width * zoomFactor,
    height: cssRect.height * zoomFactor,
  })
  return `${Math.round(physical.width)}x${Math.round(physical.height)}+${Math.round(physical.x)}+${Math.round(physical.y)}`
}

/** Engine args that open the game borderless, on top, at `geometry`. */
export function stageLaunchArgs(geometry: string): string[] {
  return [
    '+set', 'vid_fullscreen', '0',
    '+set', 'win_noborder', '1',
    '+set', 'win_notitle', '1',
    '+set', 'win_alwaysontop', '1',
    '+set', 'win_noresize', '1',
    '+set', 'vid_geometry', geometry,
  ]
}

/** Engine args for the ordinary (unstaged) window. */
export function normalWindowArgs(): string[] {
  return ['+set', 'vid_fullscreen', '0']
}

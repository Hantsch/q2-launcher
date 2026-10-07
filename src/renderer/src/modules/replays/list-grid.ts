/**
 * The one column template the demos list's header (`DemoListHeader.tsx`) and every row
 * (`DemoRow.tsx`) share, so a header label always sits exactly above the cell it names - same
 * reasoning as `SERVER_LIST_GRID` (`../servers/list-grid.ts`). The identity column takes whatever
 * is left, after a 1.5rem select-checkbox column; the six data columns after it (map, mod, players/sides, date, duration,
 * favourite/rating) are fixed-width and right-aligned. Both the header and each row carry a 2px
 * left border (transparent on the header, the selection/marker edge on a row) so their text starts
 * on the same x.
 */
export const DEMO_LIST_GRID =
  'grid grid-cols-[1.5rem_minmax(0,1fr)_7rem_6rem_11rem_9rem_4.5rem_5rem] items-center gap-x-4 border-l-2 pr-4 pl-3'

/** Fixed row height (px) the demos list lays every `DemoRow` out at - a single constant so a
 * future virtualization pass and any layout math agree with the actual rendered row. */
export const DEMO_ROW_HEIGHT = 56

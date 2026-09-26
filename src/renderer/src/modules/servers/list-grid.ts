/**
 * The one column template the servers list's header (`ServerListHeader.tsx`) and every row
 * (`ServerRow.tsx`) share, so a header label always sits exactly above the cell it names - the
 * name column takes whatever is left, the four data columns are fixed-width and right-aligned.
 * Both the header and each row also carry a 2px left border (transparent on the header, the
 * selection/marker edge on a row) so their text starts on the same x.
 */
export const SERVER_LIST_GRID =
  'grid grid-cols-[minmax(0,1fr)_6rem_5.5rem_6.5rem_4.5rem] items-center gap-x-4 border-l-2 pr-4 pl-3'

/** Sets a slice's `listSort`, or removes the key entirely (absent on disk, never `undefined`). */
export function setOrClearListSort<S extends { listSort?: T }, T>(slice: S, sort: T | null): S {
  if (sort === null) {
    const { listSort: _dropped, ...rest } = slice
    return rest as S
  }
  return { ...slice, listSort: sort }
}

/**
 * Pre-existing, unrelated spawn/network use sites in `src/main` that have nothing to do with the
 * downloads pipeline - named explicitly so the guard does not false-positive on legitimate code
 * while still catching anything new. Shared by the spawn/network guard and the docs-lane check
 * that `docs/ARCHITECTURE.md` names every entry.
 *
 *  - `services/launch.ts` spawns the game executable (`child_process.spawn`).
 *  - `lib/win-registry.ts` shells out to `reg.exe` (`child_process.execFile`) to read the Windows
 *    registry, since every native alternative needs a prebuild.
 *  - `lib/renderer-source.ts` only *mentions* `net.fetch` in a doc comment (contrasting its own
 *    protocol handler with delegating to `net.fetch(file://...)`) - not an actual network call.
 *  - `modules/home/news/feed-fetcher.ts` only *mentions* `net.fetch` in its module doc comment,
 *    contrasting the global `fetch` it actually uses with `net.fetch` (deliberately unused, same
 *    reasoning as `renderer-source.ts` above) - not a network call via that API. Its real calls go
 *    through the global `fetch`, which this guard does not flag: the `home` module's own `network`
 *    capability (`src/shared/types/module.ts`) is what authorizes them (story 082).
 *  - `modules/home/images/fetch-image.ts` only *mentions* `net.fetch` in its doc comments,
 *    contrasting the global `fetch` it actually uses (same wrapper/budget as `feed-fetcher.ts`) with
 *    `net.fetch` (deliberately unused, same reasoning as above) - not a network call via that API
 *    (story 084).
 *  - `lib/zip-entries.ts` spawns the vendored 7-Zip to list and read zip entries (story 143).
 *  - `modules/replays/index.ts` resolves the vendored 7-Zip binary path (`resolveExtractorPath`)
 *    to hand to the zip scanner; it does not spawn anything itself, `zip-entries.ts` does.
 */
export const ALLOWED_MAIN_SPAWN_NETWORK_FILES: ReadonlySet<string> = new Set([
  'src/main/services/launch.ts',
  'src/main/lib/win-registry.ts',
  'src/main/lib/renderer-source.ts',
  'src/main/modules/home/news/feed-fetcher.ts',
  'src/main/modules/home/images/fetch-image.ts',
  'src/main/lib/zip-entries.ts',
  'src/main/modules/replays/index.ts',
  'src/main/lib/net/fetcher.ts', // shell-owned download/extract infrastructure (story 209)
  'src/main/lib/archive/extractor.ts', // shell-owned download/extract infrastructure (story 209)
  'src/main/lib/archive/7za-path.ts', // shell-owned download/extract infrastructure (story 209)
  'src/main/services/package-staging.ts', // shell-owned download/extract infrastructure (story 209)
])

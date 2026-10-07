# Home module

Status: **Implemented.** The landing screen: a community news carousel fed from the content repo,
and a dashboard of tiles the user arranges on a grid. The long design reference is
[home-screen.md](home-screen.md).

This document describes the module as built. `home` is a registered module; its contract is
`src/shared/modules/home.ts`.

## Purpose

- Fetch the community news feed (an index plus one markdown document per slide), validate it,
  cache it and hand the renderer slides that are already filtered and sorted.
- Show the slides in a hero carousel in four templates (split, banner, text, cover), with images
  served from the launcher's own cache, never from a remote origin.
- Show a dashboard grid of tiles (playtime, config profiles) the user can move, resize, remove and
  reset, and persist that arrangement.

## Map

**Main** (`src/main/modules/home/`)

- `index.ts` — the module: registers every handler, pushes the event, and starts one
  fire-and-forget refresh at registration.
- `news/news-service.ts` — decides when to fetch and what to deliver; no timer, no focus hook.
  The visibility window and `order` sort run again on every delivery.
- `news/feed-fetcher.ts` — conditional GET per document (5 s budget, one retry on timeout,
  network error or 5xx, 1 MiB cap per document). Never returns partial material.
- `news/feed-pipeline.ts` / `news/frontmatter.ts` — validation, template fallback, button cap.
- `news/feed-cache.ts` — the feed's own cache file; `news/harness.ts` — the loopback source used
  by UI verification.
- `images/fetch-image.ts` / `images/image-cache.ts` / `images/resolve-feed-images.ts` — image
  download (size, type and dimension limits), count-capped cache with a keep-set, and the
  rewrite of a slide's image path to a cached, content-addressed URL.
- `open-slide-url.ts` — scheme and host check before a slide button opens externally.
- `persisted.ts` — the forgiving parse of the dashboard layout.

**Shared** (`src/shared/`, pure)

- `modules/home.ts` — handler map, event, schemas, news and layout types, grid constants,
  the button host allowlist.

**Renderer** (`src/renderer/src/modules/home/`)

- `HomeView.tsx`, `NewsHero.tsx`, `carousel.ts`, `feedState.ts`, `client.ts`, `locale/en.json`.
- `components/` — `SlideSplit.tsx`, `SlideBanner.tsx`, `SlideText.tsx`, `SlideCover.tsx`,
  `SlideButtons.tsx`, `resolveSlideTemplate.ts`, `DashboardTileFrame.tsx`, `useTileData.ts`.
- `dashboard/` — `Dashboard.tsx`, `DashboardGrid.tsx`, `DashboardTile.tsx`, `layout.ts` (the
  placement engine), `dashboard-modules.tsx` (the tile registry), `PlaytimeTile.tsx`,
  `ConfigProfilesTile.tsx`, `ArrangeBar.tsx`, `ArrangeToggle.tsx`, `ResetLayoutDialog.tsx`.

## Persisted state

- `homeLayout` in state.json — the tile placements (module id, x, y, w, h in cells). Rows are
  parsed forgivingly: an unknown module id, a malformed row or a repeated module id costs only
  that row (first occurrence wins). A layout is never padded back to the default; only an
  unreadable envelope falls back to it.
- news-feed.json in the user data folder — validated slides, one ETag per document and the last
  retrieval time. Regenerable, and kept out of state.json.
- Cached news images in the user data folder — content-addressed files, evicted oldest first down
  to a count cap; the current feed's images are never evicted.

## Handlers

`HOME_HANDLERS`:

- `newsGet` — the cached feed, filtered and sorted now; makes no network call.
- `newsRefresh` — re-fetches the feed; on failure resolves to the last cached feed.
- `openSlideUrl` — opens a slide button's URL externally; refused unless `https` and the host is
  on the allowlist.
- `getLayout` — the persisted dashboard layout.
- `setLayout` — validates and persists a whole layout; unknown module ids are dropped.
- `resetLayout` — restores the default two-tile layout.

Events: `HOME_EVENTS` pushes `newsChanged`, only when a refresh changed the delivered feed.

## External inputs

- Network: HTTPS GET of the news index and the markdown documents it names from the content
  repo, and of each slide image from the same source. Document names are foreign content and
  must be one plain file-name segment.
- Files: state.json (`homeLayout`), news-feed.json and the news image cache.
- Slide buttons are foreign URLs: only `https` on `github.com` or `raw.githubusercontent.com`.

## Limitations

- The feed is fetched once at startup and on an explicit refresh; there is no timer.
- `schemaAhead` and `lastRefreshFailed` describe the last refresh in this process and are not
  persisted.
- A failed fetch is silent: the last cached feed stays, with a stale marker, never a dialog.
- The dashboard knows two tiles; the grid is fixed (12 columns, 40 px rows) and only placement
  is configurable.

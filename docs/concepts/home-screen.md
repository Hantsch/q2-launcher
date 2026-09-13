# Home Screen — News Hero + Customizable Dashboard — Concept

Status: **Draft** (vision + requirements, no stories yet). This document fixes what the launcher's
home screen becomes: a fixed news carousel at the top, fed from the public
`Hantsch/q2_community_content` repository, and below it a free grid of dashboard modules the user
arranges and resizes themselves. It also fixes the contract of that content repository (layout,
`index.json`, per-entry markdown, named slide templates) and the ownership shift of the home screen
from the shell into a new `home` module. Everything here comes from the requirements interview of
2026-09-07; nothing was inferred.

This document follows the architecture rules in [CLAUDE.md](../../CLAUDE.md): a feature is a module
(here: `home`), the IPC contract is written in `src/shared/ipc.ts` first, every renderer-supplied
payload carries a zod schema, and no bundled image assets enter the UI. Two of those rules needed
an explicit decision rather than a silent bend — see §9. It builds on the existing shell
([AppShell.tsx](../../src/renderer/src/components/shell/AppShell.tsx),
[HeroPanel.tsx](../../src/renderer/src/components/shell/HeroPanel.tsx)), the `library` module's
`LibraryStats` handler, the `config` module ([config-module.md](../systems/config-module.md)) and
the `@dnd-kit` primitive introduced by story 054
([SortableList.tsx](../../src/renderer/src/components/dnd/SortableList.tsx)).

---

## TL;DR

- **Vision:** the home screen stops being a static placeholder and becomes two things at once — a
  living community front page (news, like the Blizzard launcher's hero) and a workspace the user
  lays out themselves.
- The **news zone is fixed and is the hero carousel** — it replaces today's `HeroPanel` entirely.
  There is no news dashboard module and no "Featured" tile row.
- Content comes from **`raw.githubusercontent` on `main`** of the public repo. The repo is laid out
  as `news/`, `packs/`, `mods/`, `config_templates/`; **v1 fills only `news/`.**
- A **hand-maintained `index.json`** decides *which* entry is shown, *when* (visibility window) and
  *in which order* (`order`). Each entry's **`.md`** carries the template, the content and its
  buttons.
- Slide **templates are fixed renderers in the launcher** (`split`, `banner`, `text`); the `.md`
  only fills template-defined fields. Contributors get no design freedom. Unknown template →
  rendered as `text`.
- Buttons: **max 3, external links only**, `shell.openExternal` against a host allowlist in main.
- **Images are fetched and cached by main** and served over the existing `q2launcher://` scheme —
  the production CSP stays `'self'`.
- Fetch **on app start + manual refresh**, last good feed cached in userData, offline shows the
  cache with an "as of …" note. First start without any cache shows a **built-in welcome slide**.
- The **`home` module owns the whole screen** — hero, grid, module catalog and layout persistence.
  `AppShell` loses `HomeView`.
- Dashboard: **free x/y/w/h grid, 12 columns × 40px rows, hand-rolled on `@dnd-kit`**, explicit
  **arrange mode**, keyboard parity (Space lifts, arrows move, Shift+arrows resize), **one layout +
  reset**.
- **v1 has exactly two real modules:** Playtime & statistics, and Config profiles. Planned modules
  (Gamebrowser, Friendlist, Downloads, Mods, Assets) do not appear on the home screen at all.
- **The composition is decided**: the click dummies under `docs/prototypes/home/` ran, and
  **variant A won** — a 320px hero over a dashboard showing ~6 rows, default layout two modules at
  6 × 5 cells. A Blizzard-style fixed right-hand friend-list column was raised and postponed.
- Biggest open points: that right-hand column, the narrow-window stacking threshold, the image
  cache budget, the button host allowlist, and feed prose being English-only.

---

## 1. Vision

Today's home screen is honest about being unfinished: a hero showing the active installation with
four carousel dots wired to nothing, and below it a grid of module cards that is really the
roadmap. It tells a new user what the launcher *will* do, not what is going on in Quake II.

The new home screen does two jobs at once, and keeps them strictly apart:

- **Above: the community front page.** A fixed, rotating news hero, curated by the maintainer in a
  public repository. It is what makes the launcher feel like a launcher and not a settings editor —
  a new engine build, a texture pack, a tournament, a guide. The user does not configure this zone,
  and it does not compete for space with the user's own layout.
- **Below: the user's own workspace.** A free grid the user fills, moves and resizes. Whoever only
  cares about their config profiles builds a screen of config; whoever plays a lot builds a screen
  of playtime and, later, a server browser and a friend list. The launcher does not decide what
  matters to a player.

The split is the point. The top is *ours* and always looks the same for everyone; the bottom is
*theirs* and the launcher never rearranges it.

## 2. Scope

### In scope (v1)

- A `home` module (main + renderer halves) owning the home route.
- The fixed news hero: carousel with dots, previous/next, pause, auto-rotation honouring the motion
  setting, and a built-in welcome slide as the empty state.
- Feed retrieval in main: fetch `index.json` and the referenced `.md` files from
  `raw.githubusercontent`, validate, filter by visibility window, sort by `order`, cache in
  userData, push to the renderer over IPC.
- Image retrieval and caching in main, served over `q2launcher://`.
- Three named slide templates (`split`, `banner`, `text`) as launcher-side renderers.
- Button rendering (max 3 per slide) with `shell.openExternal` against a host allowlist.
- The dashboard grid: 12 columns × 40px rows, free x/y/w/h, hand-rolled on `@dnd-kit`, with an
  explicit arrange mode, a catalog bar to drag modules from, full keyboard parity, single-column
  stacking below the narrow-window threshold, one persisted layout and a reset action.
- Two real dashboard modules: **Playtime & statistics** (from `LibraryStats`) and **Config
  profiles** (profiles with sync/care state, jumping into the editor).
- The layout structure in `state.json` plus its zod schema.
- The content repository's `news/` directory, its `index.json` contract and the per-template
  frontmatter contract, documented in the public repo's own README.
- 2–3 HTML click dummies under `docs/prototypes/home/` differing in hero ↔ dashboard composition,
  as the decision basis for the final geometry.

### Deliberately not in v1

- **`packs/`, `mods/`, `config_templates/` content.** The directories are part of the repo layout
  from day one, but nothing reads them yet.
  > Rationale: a pack or mod entry is only useful once it can be installed, and the Downloads,
  > Mods and Assets modules do not exist. `config_templates/` is the closest to feasible (the
  > config module already has an import path) but was still left out to keep v1 one feature, not
  > two.
- **In-app news detail view / markdown rendering in the renderer.** Buttons open externally.
  > Rationale: rendering foreign markdown means sanitizing plus CSP discipline for a screen nobody
  > asked for; the templates already carry the content that matters.
- **Typed in-launcher slide actions** (`openRoute`, `installPack`, `importTemplate`).
  > Rationale: v1 buttons are external links only. A reserved-but-unimplemented action space was
  > explicitly rejected — no contract fields without a consumer.
- **Multiple named dashboard layouts, and per-installation layouts.**
  > Rationale: one layout plus a reset is enough to recover from a mess; a management layer for
  > layouts is a feature of its own.
- **An "active installation" dashboard module.**
  > Rationale: the identity of the active installation already lives in `ActionBar` and
  > `InstallationRail`; the user accepted a sparse first start rather than a third surface saying
  > the same thing. Revisit if the empty-feeling first start turns out to bite.
- **Planned-module placeholder tiles.** Gamebrowser, Friendlist, Downloads, Mods and Assets are not
  offered, not greyed out, not in the catalog.
  > Rationale: the home screen stops being the visible roadmap; that job belongs to
  > [ROADMAP.md](../ROADMAP.md) and the nav bar's own planned-module screens (story 033).
- **Periodic background refresh and focus refresh.**
  > Rationale: start + manual refresh was chosen deliberately; an interval is additive later if a
  > long-running launcher turns out to go stale in practice.

### Non-goals (permanent)

- **The feed never executes anything.** No script, no command, no auto-download, no install
  triggered by content from the repository. A slide is text, an image, and links.
  > Content is fetched over the network from a public repo; treating it as instructions would make
  > every launcher a remote-execution target for whoever can land a commit or MITM a raw URL.
- **Contributors do not get design control.** No CSS, no HTML, no colours, no layout values in the
  feed. Templates are fixed renderers; a slide picks one and fills its fields.
  > A community front page that can style itself becomes n different design systems and breaks the
  > launcher's own token layer.
- **The launcher never rearranges the user's dashboard.** No auto-layout "improvements", no new
  module inserting itself into a saved layout, no reset on update.
  > The whole promise of the lower half is that it stays as it was left.
- **No bundled image assets in the UI.** The welcome slide, every template's chrome and every empty
  state are CSS/inline SVG. Only *feed* images are bitmaps, and they come from the network.
  > CLAUDE.md's rule, kept; see §9 for the deviation this required.

## 3. Design decisions taken (from the requirements interview)

| Topic | Decision | Rationale (user's) |
| --- | --- | --- |
| Shape of the news zone | A fixed hero carousel, nothing else | "hero-carousel ist das was ich mir unter news liste vorgestellt habe, kein zusätzliches modul" |
| Featured tile row | None — the hero is the whole news zone | Everything below the hero belongs to the user |
| News as a dashboard module | No | The news zone is fixed, not something to place |
| Today's `HeroPanel` | Replaced entirely by the news hero | Identity of the active installation already lives in `ActionBar` and `InstallationRail` |
| Content transport | `raw.githubusercontent` on `main` | No token, no rate limit, a commit publishes |
| Repo layout | `news/`, `packs/`, `mods/`, `config_templates/`; v1 fills `news/` | Fixes the later content types now at almost no cost |
| Content types in v1 | News only | Packs/mods need modules that do not exist |
| Feed index | A hand-maintained `index.json` | Needed anyway, because it also carries visibility control |
| `index.json` contents | Which entry, when it is visible, in which order (`order` number) | "ich möchte steuern können ab wann ein beitrag angezeigt wird und ab wann nicht mehr" |
| `.md` contents | Template, content, buttons | Editorial control in one file, the text next to the entry |
| Slide templates | Fixed, named renderers in the launcher; the `.md` fills template-defined fields | "die community die den content liefert braucht fixe vorlagen und keine design möglichkeiten" |
| v1 template set | `split`, `banner`, `text` | Covers image-left/right, image-top and text-only |
| Invalid/unknown template | Fall back to the `text` template | Content is never silently lost |
| Buttons | Max 3, external links only, host allowlist in main | Covers v1 news completely without a target module |
| Slide images | Fetched and cached by main, served over `q2launcher://` | CSP stays `'self'`, images work offline |
| Fetch cadence | App start + manual refresh | Predictable, sparse |
| Offline behaviour | Show the cached feed with an "as of …" note; a failure is quiet, never an error dialog | News are not important enough to shout about |
| First start without cache | A built-in, offline-capable welcome slide (CSS/SVG), displaced by real news | Nicest first start |
| Carousel behaviour | Auto-rotation with dots and a pause control; pause on hover/focus; no auto-rotation under `motion: reduced` | Close to the Blizzard reference without fighting the motion setting |
| Ownership | A new `home` module owns hero, dashboard, catalog and layout; `AppShell` loses `HomeView` | Rule-conform: a feature is a module |
| Dashboard layout model | Free grid with x/y/w/h and resize | Maximum freedom for the user's own screen |
| Grid geometry | 12 columns × 40px rows | Fine resolution; thirds and quarters both work out |
| Grid implementation | Hand-rolled on `@dnd-kit` | One dependency fewer than a grid library; keyboard path and design tokens stay under our control |
| Narrow window | Columns shrink proportionally; below a threshold the grid stacks into one column without changing the stored layout | No data loss, no horizontal scrolling |
| Editing | An explicit arrange mode (button toggles handles, resize grips and the catalog) | No accidental drags during normal use |
| Adding a module | A catalog bar of not-yet-placed modules in arrange mode, dragged into the grid (keyboard: Enter places it at the first free spot) | One mechanism for adding and placing |
| Keyboard operation | Space/Enter lifts, arrows move one cell, Shift+arrows resize, Enter drops, Esc cancels, with `aria-live` announcements | One state machine for pointer and keyboard |
| Layouts | One layout, plus "reset to default" | Simplest persistence, no management UI |
| Real v1 modules | Playtime & statistics, Config profiles | The data already exists |
| Planned modules on the home screen | Not shown at all | Cleanest surface |
| Prototype | 2–3 HTML variants differing in the hero ↔ dashboard composition | The question best decided by looking at it |
| Composition (decided on the prototype, 2026-09-07) | **Variant A — a 320px hero over the dashboard**, i.e. the news zone takes about half the main area and the dashboard shows ~6 grid rows without scrolling | Picked from `docs/prototypes/home/`; B's dashboard gain was not worth what 176px does to the `split` and `banner` slides, and C's below-the-fold dashboard contradicts the vision's "the bottom is theirs" |
| A fixed right-hand column (Blizzard-style friend list) | **Not now** — no third fixed zone; the hero keeps the full width next to the rail | Raised and set aside by the user on 2026-09-07 to be thought through separately; see open point 1 |

## 4. Tech decisions

| Area | Choice | Rationale |
| --- | --- | --- |
| Grid / DnD | `@dnd-kit` (already a dependency, story 054) with a hand-written cell/collision/resize layer and a pure `layout.ts` | No new dependency; keyboard sensors and announcements come from the library, geometry and tokens stay ours |
| HTTP | An HTTP client in the **main** process only (first network code in this repo) | Production CSP is `connect-src 'self'`; main-side fetch keeps it that way and matches "main owns effects" |
| Feed format | JSON index + markdown entries with YAML-style frontmatter, validated with zod in main | The repo's validation convention; unvalidated foreign data never reaches the renderer |
| Image delivery | Main-side download into userData, served over the existing `q2launcher://` privileged scheme | Story 035's scheme already exists and travels with the CSP |
| Layout persistence | A new top-level key in `state.json` with its own zod schema and defensive parse (the `configProfiles` precedent) | `LauncherSettings` is a closed shape; a layout is module state, not a setting |
| Prototype | Static HTML/CSS under `docs/prototypes/home/`, hand-copied token values, `index.html` picker + lettered variants | The convention already used by `docs/prototypes/{bindings,settings}` |

## 5. Core terms & model

- **News zone / hero** — the fixed upper region of the home screen. Not user-configurable.
- **Feed** — the validated, filtered, ordered list of slides derived from the content repository.
- **Entry** — one item in `index.json`, pointing at one `.md` file in `news/`.
- **Slide** — one rendered entry in the carousel.
- **Template** — a named launcher-side renderer (`split`, `banner`, `text`) with a fixed field set.
- **Dashboard** — the lower region: a free grid of modules.
- **Dashboard module** — one tile with an id, a component, a data source and a min size. Distinct
  from a *launcher module* (`config`, `library`, `home`) — a dashboard module lives inside `home`.
- **Arrange mode** — the editing state of the dashboard.
- **Catalog** — the list of dashboard modules not currently placed.
- **Layout** — the persisted placement: one record per placed module with x, y, w, h.

```
  q2_community_content (main)                 Q2 Launcher
  ┌──────────────────────────────┐            ┌──────────────────── main process ───────────────┐
  │ news/index.json              │  raw https │  home module                                    │
  │ news/2026-09-07-q2pro.md     │───────────►│   fetch → zod validate → filter (visible now)   │
  │ news/img/q2pro.png           │            │   → sort (order) → cache (userData)             │
  │ packs/  mods/  config_templ. │            │   images → download → userData → q2launcher://  │
  └──────────────────────────────┘            └───────────────┬─────────────────────────────────┘
                                                              │ IPC (typed, shared/ipc.ts)
                                              ┌───────────────▼─────────────── renderer ────────┐
                                              │  HomeView (home module)                         │
                                              │  ┌────────── news hero (fixed) ──────────────┐   │
                                              │  │ slide = template(split|banner|text)       │   │
                                              │  │ dots · prev/next · pause                  │   │
                                              │  └───────────────────────────────────────────┘   │
                                              │  ┌────────── dashboard (user's) ─────────────┐   │
                                              │  │ 12 cols × 40px · free x/y/w/h · arrange   │   │
                                              │  │ [ Playtime & stats ] [ Config profiles ]  │   │
                                              │  └───────────────────────────────────────────┘   │
                                              └─────────────────────────────────────────────────┘
                                                              │
                                                     state.json (layout)
```

## 6. The content repository

Repository: `https://github.com/Hantsch/q2_community_content`, branch `main`, public. Today it
contains only a LICENSE — the layout below is created by this concept's stories.

```
news/
  index.json                 the editorial control file (hand-maintained)
  2026-09-07-q2pro-1-2.md    one file per entry
  img/                       images referenced by entries
packs/                       (reserved, empty in v1)
mods/                        (reserved, empty in v1)
config_templates/            (reserved, empty in v1)
README.md                    the contract: index.json fields + per-template frontmatter
```

### 6.1 `news/index.json`

Hand-maintained. It answers three questions and nothing else: **which** entries exist, **when**
each is visible, and **in which order** they appear.

```jsonc
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "q2pro-1-2",            // stable, unique; identity across edits
      "file": "2026-09-07-q2pro-1-2.md",
      "order": 10,                   // ascending; lower = earlier in the carousel
      "visibleFrom": "2026-09-07",   // optional; inclusive
      "visibleUntil": "2026-10-01"   // optional; exclusive
    }
  ]
}
```

- Order is **`order`**, not the filename and not the date — filenames stay free-form (the
  `YYYY-MM-DD-slug.md` shape above is a convention for humans, not something the launcher parses).
- An entry whose window has not started, or has ended, is filtered out **in main** and never
  reaches the renderer.
- An entry that fails validation (missing file, unparseable, duplicate id) is dropped with a log
  line; the rest of the feed still renders.

### 6.2 An entry's `.md`

Frontmatter selects the template and fills its fields; the fields are defined per template, and the
launcher validates them per template.

```markdown
---
template: split
title: Q2PRO 1.2 is out
tag: RELEASE
image: img/q2pro.png
imageSide: left            # split only
buttons:
  - label: Changelog
    url: https://github.com/skullernet/q2pro/releases
  - label: Download
    url: https://github.com/skullernet/q2pro/releases/latest
---

Body text of the slide.
```

- **Max 3 buttons.** A fourth is dropped with a log line.
- **Every button is an external URL**, opened with `shell.openExternal` and checked against a host
  allowlist in main. A URL outside the allowlist renders no button.
- The **body** carries the slide's prose. It is treated as text by the renderer — no markdown
  rendering in v1 (see "Deliberately not in v1").
- An **unknown `template`** value, or a known template with a missing image, is rendered by the
  `text` template as long as `title` and body text exist. Without those, the entry is dropped.

### 6.3 Templates in v1

| Template | Fields | Shape |
| --- | --- | --- |
| `split` | `title`, `tag?`, `image`, `imageSide: left \| right`, `buttons?`, body | Image on one side, title/tag/text/buttons on the other |
| `banner` | `title`, `tag?`, `image`, `buttons?`, body | Image across the top, text and buttons below |
| `text` | `title`, `tag?`, `buttons?`, body | Typography only; also the fallback renderer |

A new template is a change **in the launcher**, not in the content repo — the repo's README
documents which template names the current launcher understands.

## 7. The news hero

- **Height: 320px**, about half of the main area at a 1280×820 window — decided on the prototype
  (§11, variant A). The hero spans the full width between the installation rail and the window
  edge; there is no column beside it.
- **Rotation:** auto-advance on an interval *(placeholder: 8 s — not decided)*, dots for direct
  selection, previous/next, and an explicit pause control (the Blizzard reference's shape, and the
  four dead dots in today's `HeroPanel` finally get content).
- **Pause** on pointer hover and on keyboard focus anywhere inside the hero; the pause control
  latches until pressed again.
- **Motion:** with `settings.motion` reduced (or `prefers-reduced-motion`), auto-rotation does not
  run at all and slide changes do not animate. Dots and prev/next still work.
- **Empty state:** if no feed was ever cached (first start, offline), the hero shows the built-in
  welcome slide — CSS/inline SVG only, no bitmap, and it names the first steps. It is displaced as
  soon as a real feed arrives.
- **Stale state:** a cached feed shown after a failed refresh carries a quiet "as of <date>" note
  plus the manual refresh affordance. A fetch failure never raises a toast or a dialog.
- **Accessibility:** the carousel is a labelled region, slide changes are announced through a
  polite live region, every control is reachable and focus-visible, and the running slide count is
  exposed as text (not colour) — `ui:verify` runs a 0-violation axe gate, and the hero is the first
  screen it sees.

## 8. The dashboard

### 8.1 Grid

- **12 columns × 40px rows.** A module occupies `x`, `y` (cell coordinates) and `w`, `h` (cell
  spans). Gaps are allowed — the grid never compacts a layout by itself.
- Columns **shrink proportionally** with the window. Below a threshold *(placeholder: 900px — not
  decided)* the grid renders as a single column in layout order (row-major, top-left first). The
  **stored layout is not modified** by this — widen the window and the layout is back.
- Each module declares a **minimum size** in cells; a resize cannot go below it.
- Collisions are refused rather than resolved: a move or resize that would overlap another module
  is not applied, and the drop target is shown as invalid while dragging.

### 8.2 Arrange mode

- A dedicated control toggles arrange mode. Outside it, tiles behave as normal, clickable content
  and no drag can start; inside it, tiles become inert, drag handles and resize grips appear, and
  the **catalog bar** of not-yet-placed modules opens.
- Adding: drag a catalog entry into the grid, or focus it and press Enter to place it at the first
  free spot that fits its minimum size.
- Removing: a per-tile action in arrange mode returns the module to the catalog.
- **Reset to default** lives in arrange mode and restores the shipped default layout after a
  confirmation.
- **Entering arrange mode must not move a single tile.** The catalog bar and the announcement line
  are docked over the bottom of the dashboard rather than pushed into the flow — the prototype
  showed that putting them in the flow squeezes the grid and shifts the user's layout the moment
  the mode opens.
- Leaving arrange mode is what "done" means; persistence itself is immediate per change (a change
  is saved as it happens, so a crash cannot lose a rearrangement).

### 8.3 Keyboard parity

One state machine drives pointer and keyboard:

| Key | Effect |
| --- | --- |
| `Space` / `Enter` on a tile's handle | Lift the tile |
| Arrow keys (lifted) | Move one cell |
| `Shift` + arrows (lifted) | Grow/shrink by one cell |
| `Enter` (lifted) | Drop |
| `Esc`, blur, `Tab` (lifted) | Cancel and restore the pre-lift placement |

Every lift, move, resize, drop and cancel is announced through an `aria-live` region, and a visible
status line mirrors the announcement so pointer and keyboard users see the same feedback.

### 8.4 Modules in v1

| Module | Data source | Content |
| --- | --- | --- |
| Playtime & statistics | `library` module's `stats` handler (`LibraryStats`) | Installations by status and engine, favourites, total playtime, last session |
| Config profiles | `config` module | Profiles with their sync and care state; opens the editor |

Each tile carries a uniform frame with four explicit states — loading (skeleton), error (with
retry), empty (a sentence plus an action) and filled — so a failing data source degrades in one
place instead of per module.

## 9. Rule conflicts and how they are resolved

Two of `CLAUDE.md`'s rules are touched by this concept. Both are resolved by decision, not by
bending the rule quietly:

1. **"Adding a feature is a module — never edit the shell."** The home screen *is* shell today
   ([HomeView.tsx](../../src/renderer/src/views/HomeView.tsx), the route table in
   [AppShell.tsx](../../src/renderer/src/components/shell/AppShell.tsx), and
   [HeroPanel.tsx](../../src/renderer/src/components/shell/HeroPanel.tsx)). **Decision: a new
   `home` module takes it over completely** — hero, dashboard, catalog, layout persistence and the
   home route's view. `AppShell` loses `HomeView` and `HeroPanel`; the consequence is that "home is
   one of the shell's fixed zones" (its own comment) stops being true, and that is accepted.
2. **"No image assets in the UI — all surfaces are CSS/inline SVG."** Slide templates with an image
   break this if read literally. **Decision: the rule keeps applying to everything the launcher
   ships; feed images are foreign content, not UI assets.** They are never bundled, always
   downloaded, always cached, and never required for a slide to render. This needs an explicit
   deviation row in `CLAUDE.md` with this rationale — without it, it is a violation, not a
   decision.

A third rule is untouched but worth stating: **"main sends i18n keys, never prose."** Feed text is
*data*, not a UI string — it crosses IPC as content, exactly like a config file's text does today.
Every label *around* the content (pause, next, "as of …", the welcome slide, arrange mode, the
catalog, empty and error states) is an i18n key.

## 10. Integration with existing systems (architecture notes)

- **Module registration** follows [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module):
  a manifest entry in `src/shared/types/module.ts` (`home`, with the `network` capability), a main
  half under `src/main/modules/home/`, a renderer half in `src/renderer/src/modules/index.ts`, and
  handlers declared in the shared contract first.
- **IPC** is added to `src/shared/ipc.ts` (or the module's handler map) before any handler exists,
  with zod payload schemas in `src/shared/ipc-schemas.ts`. Channels needed: read the feed, refresh
  the feed, read the layout, write the layout, reset the layout, plus a feed-changed event for
  push-after-refresh.
- **Persistence:** a new top-level `state.json` key (e.g. `homeLayout`) with its own schema and
  defensive parse, following the `configProfiles` precedent — **not** a field in
  `LauncherSettings`, which is a closed, fixed shape. The feed cache and the image cache live as
  files in userData, not in `state.json`.
- **CSP:** unchanged. `connect-src 'self'` stays, because all network access is in main; images are
  served over `q2launcher://` from [renderer-source.ts](../../src/main/lib/renderer-source.ts)'s
  existing scheme.
- **`openExternal`:** slide buttons go through main with a host allowlist, per the electron-arch
  rule that navigation and external opening are main's decision, never the renderer's.
- **Design tokens:** hero and tiles use the semantic token layer in
  `src/renderer/src/styles/index.css`; no hex values, no raw palette classes. The dense-control
  deviations already recorded in `CLAUDE.md` apply here too if a control lands below 44px.
- **UI verification:** the home screen, the hero's stale and empty states, arrange mode and the
  catalog become entries in the `ui:verify` screen registry, with a `ui:flow` script for the
  arrange interaction (the pattern S12/S13 established). The feed must be stubbed in the fixture —
  a verification run may not depend on the network.
- **Tests:** the layout engine (place, move, resize, collide, stack, first-free-spot) and the feed
  pipeline (validate, filter by window, sort, fall back to `text`, drop invalid) are pure modules
  with unit tests; they are where the acceptance criteria are proven.

## 11. Prototype — done, variant A won

`docs/prototypes/home/` following the convention of `docs/prototypes/{bindings,settings}`:
`_home.css` with hand-copied token values, an `index.html` picker with the criteria table, and
three lettered variants. Static HTML/CSS at the app's real chrome sizes (titlebar 68px, rail 76px,
action bar 96px, window 1280×820, grid 12 × 40px), interactive without JavaScript — the slide
pills, dots and arrows switch between the three templates, one pill shows the offline/welcome
state, one turns on arrange mode with the cell grid, grips, resize handles, catalog and live
region. Throwaway, no app code involved.

The variants differed in **one dimension only — the hero ↔ dashboard composition**:

- **[a](../prototypes/home/a-large-hero.html)** — 320px hero, dashboard below (~6 rows visible).
- **[b](../prototypes/home/b-compact-hero.html)** — 176px hero over a wide dashboard (~9 rows).
- **[c](../prototypes/home/c-full-stage.html)** — hero as the full stage, dashboard below the fold.

**Result (2026-09-07): variant A.** It is the only one that keeps both halves honest — the `split`
and `banner` templates still read (B squeezes the image into a band), and the dashboard is visible
and editable without scrolling (C hides it entirely). What A fixes: the hero is **320px**, the
dashboard shows about six 40px rows, and the default layout is the two v1 modules side by side at
**6 × 5 cells each**. Still open from the prototype: the narrow-window stacking threshold (open
point 2).

A fourth composition was raised during the review and set aside: a Blizzard-style **fixed
right-hand column** for a friend list. It would be a third fixed zone and would narrow both the
hero and the dashboard, so it is deliberately not part of this concept — see open point 1.

## 12. Requirements

**Content repository (HOME-C)**

- **HOME-C1** — `news/index.json` carries `schemaVersion` and a list of entries with `id`, `file`,
  `order` and optional `visibleFrom`/`visibleUntil`.
- **HOME-C2** — An entry outside its visibility window is filtered out in main and never reaches
  the renderer.
- **HOME-C3** — Feed order is `order`, ascending; filename and date do not influence order.
- **HOME-C4** — An invalid entry (missing file, unparseable frontmatter, duplicate id, no title or
  body) is dropped with a log line; the remaining feed still renders.
- **HOME-C5** — An entry's `.md` frontmatter selects a template and fills that template's fields;
  fields are validated per template.
- **HOME-C6** — An unknown template value renders through the `text` template when title and body
  exist.
- **HOME-C7** — At most 3 buttons per slide; further buttons are dropped with a log line.
- **HOME-C8** — A button URL outside the host allowlist renders no button.
- **HOME-C9** — The repository's README documents `index.json`, every template and its fields, and
  the button rules.
- **HOME-C10** — The repository contains `news/`, `packs/`, `mods/` and `config_templates/`; only
  `news/` is read by the launcher in v1.

**Feed retrieval (HOME-F)**

- **HOME-F1** — Main fetches `index.json` and the referenced `.md` files from
  `raw.githubusercontent` on `main` at app start and on manual refresh; no other trigger.
- **HOME-F2** — Every fetched document is zod-validated in main before it is used or cached.
- **HOME-F3** — The last successful feed is cached in userData and used when a refresh fails.
- **HOME-F4** — A failed fetch produces no dialog and no toast; the hero shows the cached feed with
  an "as of <date>" note and a refresh affordance.
- **HOME-F5** — With no cache at all, the hero shows the built-in welcome slide, which uses no
  bitmap image.
- **HOME-F6** — Slide images are downloaded by main, cached in userData and served over
  `q2launcher://`; the renderer never requests a remote origin.
- **HOME-F7** — A slide whose image is missing or fails to download still renders (without the
  image).
- **HOME-F8** — The production CSP is unchanged by this feature.
- **HOME-F9** — Slide buttons open through main with `shell.openExternal`; the renderer cannot open
  a URL directly.

**News hero (HOME-H)**

- **HOME-H1** — The hero is fixed: it cannot be moved, resized, hidden or placed by the user.
- **HOME-H2** — `HeroPanel` and its dead carousel dots are gone; the home screen no longer shows
  the active installation as a hero.
- **HOME-H3** — The carousel auto-advances, and offers dots, previous/next and an explicit pause.
- **HOME-H4** — Auto-rotation pauses on hover and on focus inside the hero, and stays paused once
  the pause control is used.
- **HOME-H5** — With reduced motion, auto-rotation does not run and slide changes do not animate;
  manual navigation still works.
- **HOME-H6** — `split`, `banner` and `text` are implemented as launcher-side renderers.
- **HOME-H7** — Slide changes are announced in a polite live region; all controls are keyboard
  reachable with visible focus.

**Dashboard (HOME-D)**

- **HOME-D1** — The grid is 12 columns wide with 40px rows; a module stores `x`, `y`, `w`, `h` in
  cells.
- **HOME-D2** — Columns shrink proportionally with the window; below the threshold the grid renders
  as a single column in layout order, and the stored layout is unchanged.
- **HOME-D3** — Moving and resizing is possible only in arrange mode; outside it no drag can start.
- **HOME-D4** — A move or resize that would overlap another module, leave the grid, or go below the
  module's minimum size is refused and shown as invalid during the drag.
- **HOME-D5** — The catalog bar in arrange mode lists exactly the modules not currently placed; a
  catalog entry can be dragged in, or placed at the first free fitting spot with the keyboard.
- **HOME-D6** — A tile can be returned to the catalog from arrange mode.
- **HOME-D7** — Keyboard: Space/Enter lifts, arrows move one cell, Shift+arrows resize, Enter
  drops, Esc/blur/Tab cancels and restores the pre-lift placement — with live-region
  announcements.
- **HOME-D8** — "Reset to default" restores the shipped default layout after confirmation.
- **HOME-D9** — Exactly one layout is persisted, in its own `state.json` key with a zod schema and
  defensive parse; `LauncherSettings` is not extended.
- **HOME-D10** — Each layout change is persisted as it happens.
- **HOME-D11** — A layout record for an unknown module id is dropped on load; a module missing from
  the layout is not auto-inserted.
- **HOME-D12** — v1 offers exactly two modules: Playtime & statistics, and Config profiles.
- **HOME-D13** — Planned modules (Gamebrowser, Friendlist, Downloads, Mods, Assets) appear neither
  in the grid nor in the catalog.
- **HOME-D14** — Every tile renders one of four explicit states: loading, error with retry, empty,
  filled.

**Ownership and verification (HOME-A)**

- **HOME-A1** — A registered `home` module owns the home route, the hero, the dashboard, the
  catalog and layout persistence; `AppShell` no longer contains `HomeView` or `HeroPanel`.
- **HOME-A2** — Every new IPC channel exists in the shared contract with a zod payload schema
  before its handler.
- **HOME-A3** — All UI labels are i18n keys; only feed content crosses IPC as prose.
- **HOME-A4** — The home screen, the hero's stale and empty states, arrange mode and the catalog
  are in the `ui:verify` screen registry, and a full run stays at zero axe violations.
- **HOME-A5** — `ui:verify` and the test suite never depend on network access; the feed is stubbed
  in the fixture.
- **HOME-A6** — The layout engine and the feed pipeline are pure, unit-tested modules.
- **HOME-A7** — `CLAUDE.md` carries a deviation row for feed images against the "no image assets"
  rule.
- **HOME-A8** — The built home screen matches the composition the prototype decided: a 320px hero
  above the dashboard, no fixed column beside it, and a default layout of the two v1 modules at
  6 × 5 cells each (`docs/prototypes/home/a-large-hero.html` is the reference).

## 13. Open points

1. **A fixed right-hand column for a friend list** (Blizzard-style, full window height) — raised
   on 2026-09-07 after seeing variant A and deliberately postponed by the user for a closer look
   later. It is not a small addition: it would be a **third fixed zone**, it narrows both the hero
   and the dashboard by its width, and it contradicts the current decision that the friend list
   becomes a dashboard module. Whoever picks this up decides three things — how far the column
   reaches (full height vs. beside the hero only), whether it is fixed / hideable / its own narrow
   grid, and what it shows before a friend list exists.
2. **Narrow-window threshold** — placeholder 900px, not decided; needs a measurement of where a
   1 × 2 tile becomes unreadable.
3. **Auto-rotation interval** — placeholder 8 s, not decided.
4. **Per-module minimum size in cells** — the default layout is fixed (two modules at 6 × 5), the
   floor each module refuses to shrink below is not.
5. **Image cache budget** — maximum size, eviction policy, and what happens when a cached image's
   source disappears.
6. **Button host allowlist** — which hosts are allowed (github.com, raw.githubusercontent.com,
   which community sites), and whether it is a constant or configurable.
7. **Feed schema evolution** — how an older launcher reacts to a higher `schemaVersion`
   (ignore-with-note vs. drop the feed), and how a new template name is communicated.
8. **Conditional fetch** — whether the feed request uses ETag/If-None-Match, and its timeout and
   retry budget.
9. **Locale** — feed prose is English only in v1; whether an entry may later carry per-locale text
   or a locale filter is unresolved.
10. **Placement of the arrange control and the refresh control** — home screen header, titlebar or
    both; interacts with the titlebar utility row already recorded as a token deviation.
11. **Where `ModuleCard`'s current job goes** — today's home grid is the visible roadmap; with
    planned modules removed, whether the nav bar alone carries that discovery is untested.
12. **A "new since last visit" marker** for news entries — not discussed; would need a per-entry
    seen state.
13. **`config_templates/` as the next content type** — the closest to feasible (the config module
    already imports `.cfg` files); explicitly out of v1, but the likeliest follow-up and it may
    want the same `index.json` shape.

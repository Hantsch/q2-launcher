# Dev-only modules

`Mods` and `Assets` exist only in a dev build (`npm run dev`, `npm run build:dev`). A release build
(`npm run build`, `npm run package:*`, the release workflow) leaves them out entirely: no nav entry,
route, IPC handlers, Play with... button, Servers "local content" section or demo mod-install offer.
The switch is `DEV_MODULES` in [`src/shared/dev-modules.ts`](../src/shared/dev-modules.ts).

When Mods ships, remove it from `DEV_MODULE_IDS` and move the lines below into `## Unreleased` in
`CHANGELOG.md` so users read about it in the release that actually contains it.

## Changelog lines held back from `## Unreleased`

- **Mods** — "Play with..." next to Play: pick a mod and a map to start.
- **Mods** — Mods view shows every game directory of the selected installation.
- **Mods** — Action Quake, OpenTDM and CTF appear as catalog tiles.
- **Mods** — Install Action Quake, OpenTDM and CTF, also from a demo's mod warning.
- **Mods** — Remove a mod the launcher installed — your own demos and configs stay.
- **Mods** — Update an installed mod when the catalog has a newer version.
- **Servers** — Server detail shows whether you have its mod and map, and installs a missing mod.
- **Mods** — A second job on an installation that is already busy is now refused with an explanation.
- **Downloads** — A failed mod install now shows up in the Downloads failure log.

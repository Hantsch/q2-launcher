# Sprint S15 — Manual test plan

Everything else this sprint's stories claim is proven by an automated test — see `review.md`'s
Acceptance section. Only the two items below cannot be automated, both for the same reason: they
are OS-native dialog windows, and Playwright cannot drive an OS-native dialog at all
(`docs/UI-VERIFICATION.md`). Both stories' e2e coverage proves everything from the resolved path
onward through a harness-only stub (`Q2L_UI_HARNESS=1` + `isDev`); only the dialog's own appearance
and multi-select behaviour are left here.

## 1 — Story 067: picking a custom installation icon opens a real, working file dialog

**Preparation:** run the app in dev (`npm run dev`), open the Library view, and have at least one
image file (PNG or JPEG, any size) ready on disk to pick.

**Steps:**
1. On any installation's library card, open its action cluster and choose "Set icon…".
2. In the picker dialog, click "Choose a file…".

**Expected result:** the OS's native file picker opens, filtered to image files, and allows
selecting exactly one file. After confirming, the dialog closes and the installation's tile (rail,
library card, action bar) shows the picked image, resized into the tile.

## 2 — Story 066: picking config files to import opens a real, multi-select file dialog

**Preparation:** run the app in dev (`npm run dev`; the harness stub is gated on `isDev` and does
not activate here), and have the three fixture files `docs/fixtures/dm.cfg`,
`docs/fixtures/dmalias.cfg` and `docs/fixtures/gfx.cfg` (or any real `.cfg` files) available on
disk.

**Steps:**
1. Open the config module and start creating a new profile.
2. Choose "Import from files" as the starting point.
3. Click "Choose files…".

**Expected result:** the OS's native file picker opens, filtered to `.cfg` files, and allows
selecting more than one file in a single dialog (multi-select). After confirming, all picked files
appear listed in the dialog in the order picked, each showing its file name and containing folder.

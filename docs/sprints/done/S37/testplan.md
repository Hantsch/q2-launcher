# Sprint S37 — manual residue

Only what a test could not prove. Everything else is proven by tests (see [review.md](review.md#acceptance)). This is not an acceptance gate.

## 278 AC2 — the first dispatched release runs `ci`, then `plan`, then the builds

- **Why manual:** act cannot run the `windows-latest` `ci` job, so the runtime order exists only on GitHub.
- **Preparation:** `sprint/S37` merged into `dev` and pushed; a non-empty `## Unreleased` in `CHANGELOG.md`.
- **Steps:** dispatch `release.yml` with `dry_run: true`.
- **Expected:** jobs run in the order `ci` → `plan` → `build-linux` / `release`; `plan` waits for `ci`; no `ci-guard` polling step appears.

## 321 — real Alt+Enter racing a queued fullscreen switch

- **Why manual:** the playback stub has no window and takes no keys.
- **Preparation:** a Q2PRO installation with a demo; play it in the launcher stage.
- **Steps:** change the fullscreen setting in the launcher, then press Alt+Enter in the game within the same second.
- **Expected:** the game ends in the state of the last switch; the queued launcher switch is not lost.

## 321 — real Q2PRO at a single-sign negative origin

- **Why manual:** needs a monitor left of or above the primary one.
- **Preparation:** place a monitor so the game window origin is negative on one axis only.
- **Steps:** play a demo on that monitor, quit the launcher mid-stage, start the game by hand.
- **Expected:** `vid_geometry` carries the original, correctly signed origin; the window opens where it did before the stage.

## 326 — X11 keeper on a real Linux session (story 198 Q5)

- **Why manual:** needs a Linux host with a real X server and window manager.
- **Preparation:** a Linux machine with an X11 session and an installation with a demo.
- **Steps:** play a demo in the stage and watch the launcher log; let the window manager clamp the parked window; enable the cinema overlay while the game is ABOVE.
- **Expected:** a stray X error from a real server logs once by request name (AC2); the parked window stays where the keeper put it (AC3); the overlay shows above the game (AC6).

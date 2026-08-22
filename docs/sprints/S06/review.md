# Sprint S06 review — Say what it does, and mean what it claims

## Overview

Goal: the launcher's chrome and its planned-module screens speak to users instead of to the
people building it, and three guardrails that only looked like guardrails become real (CSP in
production, IPC payload validation that cannot be forgotten, an `ui:verify` report that is
actually green).

| Story | Status | Commit |
| --- | --- | --- |
| 031 — Rename Install → Downloads, move next to Settings | done | `66f397c` |
| 030 — Titlebar and wordmark scale up | done | `af40b34` |
| 033 — Planned-module screens explain the feature, not the engineering | done | `c51345f` |
| 029 — Drop-row message as checkbox + inline row | done | `72d8b64` |
| 035 — CSP actually applies in a production build | done | `0cbe222` |
| 036 — `handle()` requires a payload schema | done | `5c8f5d8` |
| 037 — `ui:verify` covers every surface and its report is green | **in-progress (blocked)** | `8f8794b` (WIP) |

## Implemented stories

- **031**: `install` renamed to `downloads` end to end (shared types, main, i18n, IPC namespace);
  nav entry moved out of the primary content nav into a new right-hand `UtilityButton` cluster
  next to Settings, using the previously-unused `nav.section: 'secondary'`.
- **030**: titlebar height 44px → 68px, wordmark doubled (26px/18px), nav/utility/window controls
  scaled to the 44px hit-area floor — cleans up an existing touch-target violation as a side
  effect.
- **033**: planned-module screens (Mods, Assets, Downloads) now show plain-language intro +
  highlights instead of an engineering capability checklist; the `id/route/ipc` debug line is
  dev-gated instead of removed.
- **029**: the drop-row message editor is now a "With message" checkbox + inline row, mirroring
  "With ammo"; the old icon-triggered dialog is gone, the rich `MessageEditor` opens inline
  instead of a separate text-only dialog.
- **035**: the production renderer now loads over a privileged `q2launcher://` scheme instead of
  `file://`; the production CSP travels with every protocol response, so it is verifiably in
  force instead of silently absent. `ui:verify` now drives a real production-mode build by
  stripping `ELECTRON_RENDERER_URL` from the harness's child environment.
- **036**: `handle()` and the module seam's `ModuleSetup.handle()` both require a zod schema as a
  parameter; all ~60 call sites carry a real payload schema (or an explicit `z.void()`), one
  genuinely free-form channel (`module:invoke`'s `payload`) is the one documented `z.unknown()`.
  New IPC contract/coverage test added (`src/main/ipc/index.test.ts`, `registry.test.ts`) — it did
  not exist before.
- **037** (in-progress): the write-preview and import-preview dialogs are now `ui:verify` screen
  registry entries; a full run is 17/17 screens, 0 critical/serious/moderate/minor violations;
  `page-has-heading-one` is deliberately disabled and the disabled rule is printed in the report.
  The one remaining acceptance criterion — confirming on a real desktop that a full run never
  steals focus (closing story 027) — needs a human present and was not fabricated.

## Findings & decisions

- **Security finding during 035's review**: a Windows-specific path-traversal bypass in the new
  `q2launcher://` protocol handler — `%5C`-encoded backslash segments escaped the `root` directory
  via Node's path resolution. Found and fixed during the story's own clean-agent review, with a
  regression test added. Worth a mental note for any future custom-protocol handler on Windows.
- **030 surfaced 2 pre-existing critical axe violations** on `keybind-dialog` (Config module),
  judged out of scope for 030 (pre-existing, not a regression) — correctly picked up and fixed as
  part of 037's D6 instead.
- **037's D6 root-caused the a11y debt** to two systemic issues rather than one-off fixes: form
  labels not wired to their controls (fixed via a shared `Field`/`useId()` helper) and `Modal.tsx`
  portalling dialog header/footer outside `<main>`, creating duplicate banner/contentinfo
  landmarks. Both are now structural fixes, not per-screen patches.
- **036 left a documentation gap on purpose**: `CLAUDE.md`'s pointer to
  `src/main/lib/schemas.ts` for renderer-payload validation is now only half true — IPC-payload
  schemas moved to `src/shared/ipc-schemas.ts`/`src/shared/schemas.ts`, persisted-state schemas
  stayed in `src/main/lib/schemas.ts`. The build agent deliberately left `CLAUDE.md` unchanged
  pending user sign-off rather than editing project guardrail docs unasked. **Action for the
  user:** update the `CLAUDE.md` key-rule reference, or confirm the split as-is.
- **037's own known blind spot**: `MessageEditor.tsx` was found to carry the same unwired-label
  defect as the fixed dialogs, but it is not in the `ui:verify` registry (deliberately, per the
  sprint's modal-scope decision) — documented in `docs/UI-VERIFICATION.md` as a known gap for
  whichever story adds it to the registry next.
- **Roadmap-named hardening item created**: `style-src 'unsafe-inline'` tightening (deferred by
  the user's own sprint decision in 035) is now a bullet under ROADMAP "Hardening" instead of
  floating undocumented.

## Blocked / open

- **037 stays `in-progress`.** Everything code/test/build-verifiable is done and green (full
  `ui:verify` run, 0 violations, both dialogs registered). The one open item is story 027's
  experiential acceptance criterion — confirming on the real desktop that a full `ui:verify` run
  never steals focus from another window while typing. This needs the user (or a live session)
  to run `npm run ui:verify` and observe it directly; it cannot be honestly confirmed by an
  unattended agent. Story 027 (`docs/requirements/027-quiet-ui-verification.md`) also stays
  `in-progress` until that happens.
- **CLAUDE.md's schema-location reference** (see Findings above) needs a one-line edit or an
  explicit "leave as-is" from the user.

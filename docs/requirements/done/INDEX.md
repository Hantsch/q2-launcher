# Story history

One line per finished story, appended by `/build` when it moves the file here.
Format: `- NNN — <title> · <sprint or —> · <one-sentence result>`.

The full texts live next to this file. This index is the fast overview — do not turn it into a
second roadmap.

- 001 — Config module scaffold and central profile store · S01 · module wired in with a persisted
  `configProfiles` store and a master/detail create/rename/delete view.
- 002 — Profile-installation assignment and default profile · S01 · many-to-many assignment with a
  pure, unit-tested "one default per installation" invariant and a reconcile sweep.
- 003 — Settings/cvar editor with per-engine defaults and clamps · S01 · ported source-cited
  r1q2/Q2PRO/vanilla cvar facts, engine-scope selector, cross-engine disagreement badges.
- 004 — Write profile to assigned installations on save · S01 · backup-once/diff-skip atomic
  writer with a preview modal; running installations queued as pending.
- 005 — Import an existing config into a new profile · S01 · config tokenizer + `exec`-resolving
  reader feeding a new "import from installation" profile-creation path.
- 006 — Keybinding editor with alternate binding layers · S02 · hold/toggle alt-layer alias
  generator plus per-layer key binding on the existing keyboard overview.
- 007 — In-session profile-switch bind · S02 · n-way self-rewriting alias chain cycling assigned
  profiles in-game, session-only, never touching the stored default.
- 008 — Advanced tab — categories, messages, macros, symbol picker · S02 · action-catalog,
  message composer with meta-variables/server macros, and a byte-faithful Latin-1 symbol picker.
- 009 — Multi-engine validator · S02 · validates the actual rendered profile bytes against every
  assigned engine's real limits, equally weighted, live against unsaved edits.
- 010 — Cleanup of redundant per-mod config copies · S02 · reviewed scan/remove/undo for
  duplicate per-mod `.cfg` files, backed by the shared backup-once contract.
- 011 — Assign an alt layer's trigger by binding it to a key, not at creation · S03 · `triggerKey`
  is now assignable/reassignable/clearable from the keyboard overview, not just at layer creation.
- 013 — Compact the empty alt-layers state and move the layer switcher next to the keyboard
  overview · S03 · one-line empty hint, base/layer switcher relocated into the overview header.
- 014 — Show an alt-layer trigger's action on its own keycap, and switch layers by clicking it ·
  S03 · trigger keys render their target layer and switch it on click in idle mode.
- 012 — Raw config view with reveal-in-folder · S03 · per-installation rendered-file preview with
  an on-disk badge and reveal-in-folder action.
- 015 — Advanced tab — dual-bind editor for Movement, Weapons and Weapon dropping · S03 ·
  catalogue-row Primary/Secondary bind editor with collision Cancel/Replace, replacing the
  free-form action list for these three built-in categories.
- 016 — Auto-create an Alt/Ctrl/Shift layer when a modifier is held during key capture · S03 ·
  modifier binding stored on the action itself, layer overrides a derived mirror of it — the
  redesign that finally closed AC 5 after three prior review-fix cycles blocked on row identity.
- 026 — A committed UI verification harness that drives the real app · S04 · Playwright-driven
  screenshot + axe-core harness (`npm run ui:verify`) with an isolated fixture, 14-screen registry
  and flow API; surfaced a pre-existing `config-raw` rendering bug as a follow-up.
- 017 — Overview — editing is the default, no dedicated edit mode · S04 · removed the edit-mode
  toggle; a keycap click opens `KeyBindDialog` directly outside test mode, trigger-keycap
  click-to-switch retired in favour of story 018's physical-key path.
- 018 — Test mode: trigger keys switch layers, pressed keys light up, readout always visible · S04 ·
  pure resolver + reducer drive the displayed layer from physical trigger presses, every held
  key/mouse button rings on its keycap, readout moved permanently into the legend row.
- 019 — Controls: type the entry, not the category, and let me order entries · S04 · `kind`
  moved onto each entry (bind/message/alias) instead of the category, aliases render as their
  own name and are never bound, entries reorder by hand, and undefined/unreferenced aliases are
  reported in the Validation panel.
- 020 — Controls: rename Advanced and rebuild it as the column-grid prototype · S04 · Advanced
  tab renamed to Controls end to end, rebuilt as a capped, sticky-header column grid with
  always-visible bind slots, a profile-wide conflict count, a filter, a scrollable category
  rail and whole-profile Restore defaults.
- 021 — Settings: rebuild as the dense-rows prototype · S04 · Settings tab rebuilt as a capped,
  dense-rows grid grouped by real cvar group with sticky headers, per-row engine caveats/reset,
  filter/changed-only, whole-profile Reset all, and an Advanced collapse; story 009's
  autosave/facts/honesty rules unchanged.
- 022 — A profile is a real `<name>.cfg` that exists before any assignment · S05 · every profile
  gets a canonical `<name>.cfg` in userData, name-based per-installation copies with collision
  handling, migration of old id-based files, and a live `syncState`/retry contract for stories
  023/025 to render — a review-caught rename-clobber bug was fixed with a cascading re-sync plus
  an independent overwrite guard.
- 023 — Raw File absorbs Write targets — see and open the profile's file anywhere · S05 · Write
  targets tab removed; Raw File now always shows the profile's own canonical file plus one row per
  assigned installation (present/differs/not-on-disk, open in editor, reveal in folder, played
  mods), auto-write moved to a tab-independent hook, and the pre-existing config-raw double-unwrap
  crash was fixed as a bonus.
- 024 — Read the config in the launcher with Quake 2 syntax highlighting · S05 · a pure,
  lossless, positional config tokenizer plus a memoized, gutter'd `ConfigCodeView` with a
  container-scoped find-in-file control now renders Raw File, the write-preview dialog and the
  import preview, replacing `CodeBlock` everywhere; a review-caught CSS grid track-sizing bug that
  broke gutter alignment and a dead `plusCommand` classification were both fixed before landing.
- 025 — Validation becomes Care — report, tidy-up actions and sync state in one place · S05 · the
  Validation tab is now Care: unchanged story-009 report, a story-022 sync section (5 states,
  retry), a new tidy-up section (6 finding kinds, per-item preview/apply, "fix all safe findings"
  batch), preserved lines folded in, and story-010's mod-copy cleanup moved here scoped to the
  profile's installations; a review-caught cross-engine badge-dedup bug, a false "all clear" on
  unvalidated profiles, and a summary that vanished on a sync-fetch error were all fixed before
  landing.
- 031 — Rename Install module to Downloads, move nav entry next to Settings · S06 · full `install`→`downloads` rename (id/route/ipc/i18n) plus a new icon-only titlebar button next to Settings replacing the primary-nav entry; `ui:verify` covers the new screen and a clean review passed on all acceptance criteria.
- 030 — Titlebar and wordmark scale up · S06 · titlebar grows 44px→68px via `--titlebar-h`, wordmark doubled, nav/Settings/Downloads/window controls all resized to the 44px hit-area floor; `ui:verify` confirms the new proportions and a clean review passed on all acceptance criteria.
- 033 — Planned-module screens explain the feature, not the engineering · S06 · Mods/Assets/Downloads planned screens now show plain-language intro + highlights instead of a capability checklist, id/route/ipc debug line is dev-only, `ui:verify` covers all three screens with a clean review pass.
- 029 — Drop-row team message as checkbox + inline row (mirrors "With ammo") · S06 · drop rows (weapon/ammo/misc) now show a "With message" checkbox next to "With ammo" that reveals an inline row with the current text and an Edit button opening the unchanged rich `MessageEditor` (no key capture); a new live-smoke Playwright flow and a clean review confirmed all acceptance criteria.
- 035 — CSP applies in production · S06 · production renderer now served from q2launcher:// with an enforced CSP and a harness regression guard.
- 036 — `handle()` requires a payload schema · S06 · all ~60 `handle()` call sites (shell + module seam) now take a required zod schema, validation centralized in two wrappers (`handle` throws, `handleOutcome` resolves a failed `Outcome`), new IPC + module-registry coverage tests; `ui:verify` and a `story-review-hard` review both passed clean.
- 027 — UI verification runs in one session per fixture, without stealing focus · — (ad-hoc, post-S04) · `ui:verify` went from 56 app starts per full run to 2 (one session per fixture variant, screenshot+axe in the same visit) with `Q2L_UI_HARNESS=1` gating `focusable:false`/`showInactive()` so a run never takes keyboard focus; a review-caught mid-variant crash that stranded the remaining screens and a swallowed liveness failure were fixed, and the experiential focus check was confirmed by the user at S06 acceptance.
- 037 — `ui:verify` covers every surface and its report is green · S06 · write-preview and import-preview dialogs are now screen registry entries (17 screens × 2 viewports), and a full production-mode run went from 4 critical + 16 moderate violations to zero via two structural fixes (a shared `Field`/`useId()` control-id helper, `Modal.tsx` no longer portalling duplicate banner/contentinfo landmarks); `page-has-heading-one` is deliberately disabled and named in the report, and story 027's focus check closed with this one at S06 acceptance.
- 038 — No alias line for an action the engine can bind directly · S07 · the writer now filters an action list through a new shared alias-reference graph before rendering alias lines, dropping a catalogue row's dead alias while keeping every genuinely referenced one, backed by a fixture-corpus invariant test and a live ui:verify fixture; a mid-build follow-up closed a quote-wrapped-reference detection gap and a clean review passed with only non-blocking notes.
- 039 — Aliases get readable names I control, and must be unique · S07 · alias names in the rendered config flip from `q2l_a_<slug>_<id4>` to a short readable slug (with an optional user-chosen override, validated and unique-checked), mirror ownership across all five prefix-dependent sites moved to key-scoped value matching instead of the prefix, legacy profiles migrate their `q2l_a_*` binds/overrides on read, and Care warns (never auto-fixes) on name collisions or a derived name shadowing a reserved command; two review cycles (`story-review-hard`) caught and fixed a byte-compat regression in the legacy-name reproduction, a UI input cap that made the too-long rejection unreachable, and an over-broad Care-warning exclusion that silenced the exact self-referential-alias case (`weapnext`) the story exists to warn about, plus a rename-refusal escape-hatch bug found independently; verified live via `ui:verify` and a new `ui:flow` probe driving the real rename dialog.
- 040 — The profile file is written structured, commented and human-readable · S07 · `renderProfileFile` rewritten from a flat sorted dump into commented, column-aligned sections (header, cvars by group, aliases/binds by category, one section per layer, "other" catch-alls, empty sections omitted) with a trailing `// <label>` on every generated bind/alias, plus a new per-profile `writeUnbindall` setting and its Raw File tab checkbox; `story-review-hard` caught and fixed a raw NUL byte hiding in a reverse-index separator (which had also made the file binary to grep), a case-insensitive-duplicate determinism gap in cvar ordering, and an unbounded banner line-length edge case, before passing; verified live via `ui:verify` (0 axe violations, screenshots of the new layout in the Raw File tab and write-preview dialog) on top of 1228 green tests.
- 041 — Import understands aliases, press/release pairs and unbindall · S07 · import now parses `alias` (plain, press/release, empty-body, self-rewriting, `bind`-in-body) into real Controls-tab entries instead of preserved text, resolves alias references across `exec` chains and duplicate names, and recognises colour cvars in the message editor; a `story-review-hard` pass ran the parser against adversarial input and the real `docs/fixtures` player configs and caught 3 real bugs (empty-body aliases vanishing on write-back, colour-cvar bytes at the real 0x7F boundary going unrecognised, a paired alias's release half staying permanently `aliasUnreferenced`), all fixed and re-verified; live `ui:verify` run (18/18 screens, 0 axe violations) confirms the new import-review step.
- 046 — The production CSP no longer allows inline styles · S08 · `style-src` in `PRODUCTION_CSP` dropped `'unsafe-inline'` (`DEV_CSP` untouched for Fast Refresh), backed by a unit-test regression guard and a live `ui:verify` guard requiring `style-src 'self';` in the served header plus a `securitypolicyviolation` collector wired all the way into the exit code; a review-fix cycle closed a gap where violations were collected but not actually gating the run; verified live with zero visual regression against a pre-change baseline, zero a11y findings, and zero CSP violations, and `docs/ARCHITECTURE.md` now names the permitted (React `style` prop / CSS custom properties) vs. forbidden (`setAttribute('style', …)`, literal `<style>`, `dangerouslySetInnerHTML`) forms.

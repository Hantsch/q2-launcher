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

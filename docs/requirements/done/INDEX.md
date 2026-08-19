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
- 016 — Auto-create an Alt/Ctrl/Shift layer when a modifier is held during key capture · S03 ·
  modifier binding stored on the action itself, layer overrides a derived mirror of it — the
  redesign that finally closed AC 5 after three prior review-fix cycles blocked on row identity.

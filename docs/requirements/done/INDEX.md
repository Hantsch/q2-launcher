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

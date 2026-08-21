---
id: 024
title: Read the config in the launcher with Quake 2 syntax highlighting
status: done # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

If the launcher shows me the raw config, it should be readable in the launcher — highlighted, not
a grey wall of text. A `bind`, a cvar, an `alias`, a string and a comment should be
distinguishable at a glance, the same way an editor with a Quake 2 config grammar does it.

There is an existing VS Code extension for exactly this grammar:
<https://github.com/amokmen/quake2-config-syntax>. Its token classes are a good reference for what
to recognise — check its licence before taking anything literally, and reimplement rather than
bundle a TextMate grammar and a highlighting engine into the app.

## Acceptance Criteria

- [x] A pure tokenizer in `src/shared` splits config text into tokens: comments, commands
      (`bind`/`unbind`/`alias`/`set`/`exec`/…), key names, cvar names, numbers, quoted strings,
      `+`/`-` commands, and plain text.
- [x] The tokenizer is unit-tested against real rendered profile output and against imported
      hand-written configs, including the engine's quoting rules (no nested quotes, `;` as a
      command separator) that `alt-layers.ts` documents.
- [x] The read-only viewer renders those tokens with design-token colours, monospace, line
      numbers, and text that stays selectable and copyable as the original bytes.
- [x] High-ASCII/latin1 characters (the symbol picker's output) render as-is and are not mangled by
      the highlighting.
- [x] A ~2000-line config renders without a visible delay, and an unknown line degrades to plain
      text rather than breaking the rest of the file.
- [x] The viewer replaces the plain `CodeBlock` in Raw File, in the write preview dialog and in the
      import preview, so there is one highlighted config renderer, not three.
- [x] A find-in-file control in the viewer: case-insensitive substring search over the shown text,
      a match count, next/previous (buttons and `Enter`/`Shift+Enter`), `Escape` clears, the
      current match visually distinct from the other matches and scrolled into view — and
      searching never changes what a copy of the text yields.
- [x] If anything is derived from the referenced repository, its licence and attribution are
      recorded in the repo.

## Open Questions

- ~~Highlight only, or also fold long alias bodies / jump to a bind by key name? Search inside the
  file would be genuinely useful for a 500-line config.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** In scope for this sprint: search inside the file, in addition to highlighting.
  Folding alias bodies / jump-to-bind-by-key stay out of scope — not requested, would add UI
  surface beyond a find-in-text control.
- The reference extension is **GPL-3.0** (`api.github.com/repos/amokmen/quake2-config-syntax/
  license` → `gpl-3.0`), this repo is MIT: nothing is read from or derived from its grammar, and
  the tokenizer is written from the engine facts already in this repo (`config-parser.ts`'s
  tokenizer header, `alt-layers.ts` §quoting, `key-names.ts`) — a copyleft grammar cannot be
  carried into an MIT app.
- That licence finding is recorded as a provenance block in the tokenizer's own file header —
  matching how every other ported `src/shared/config/*.ts` file records where its facts come
  from — instead of adding a new attributions document for a dependency we deliberately do not
  have.
- The tokenizer is a **new, presentation-oriented** file (`src/shared/config/config-syntax.ts`)
  and does **not** replace `src/main/modules/config/core/config-parser.ts`: that one is a lossy
  semantic parser feeding the import path, this one is a lossless span model for rendering, and
  rewriting the import path would add regression risk this story has no reason to take.
- Token classification is **positional, not catalogue-driven** (key = first argument of
  `bind`/`unbind`, cvar name = first argument of `set`/`seta`/`setu`/`sets`), so unknown cvars and
  exotic key names still highlight and the tokenizer stays free of `cvar-catalog`/`key-names`
  coupling.
- The tokenizer output is **lossless**: concatenating a line's token texts reproduces the raw
  line exactly, and that round-trip is a unit test — highlighting must never be able to change a
  byte. Line terminators are kept in the model; the viewer emits `\n` (the DOM normalises CRLF in
  a text node anyway), so the round-trip is asserted on the model, not on the clipboard.
- **No virtualization:** one `<pre>` per file with token spans, plus a `select-none`,
  `aria-hidden` line-number gutter beside it — that is what keeps a selection copyable as the
  original bytes without line numbers mixed in. Performance is carried by an O(n) single-pass
  tokenizer, memoization on content, and a throughput test, not by windowing.
- **No soft wrap** (horizontal scroll instead) — a wrapped line would desync the gutter from the
  text line-for-line.
- Highlighting is **never colour-only**: comments italic, commands semibold, and every colour
  comes from `.cfg-tok-*` classes in a new `src/renderer/src/styles/config-syntax.css` that read
  `@theme` tokens (`/design-tokens`; mirrors `controls-grid.css`).
- The find control is **always visible in the viewer header**, not a `Ctrl+F` overlay; a
  container-scoped `Ctrl+F` only focuses it — no window-level hotkey, nothing to conflict with,
  and the affordance is discoverable without a shortcut.
- Match-finding lives as a **pure helper** (`modules/config/lib/config-search.ts`) with its own
  tests, because vitest runs `environment: 'node'` here and the component itself cannot be
  DOM-tested.
- The **import preview has no raw file text** (`ImportPreviewResult` carries counts plus
  per-line snippets), so AC 6's third surface is served by the same component in a single-line
  variant over the preserved-line and duplicate-bind snippets — one renderer, and no new IPC
  field for text nobody asked to see in full.
- **No IPC change at all** (tokenizer is pure shared, viewer is renderer-only): nothing to add to
  `src/shared/ipc.ts` or the preload allowlist.
- `PreservedLinesPanel` and the other config-text surfaces stay untouched — story 025 folds that
  tab into Care, and editing a component another story is about to move is churn.
- Build order: **after 023** (per the sprint's dependency note). The viewer is a standalone
  component, so only D4 touches Raw File; if 023 has not landed, D4 attaches to today's
  `RawConfigPanel` instead, unchanged otherwise.
- The known, pre-existing `config-raw` crash (double-unwrapped `Outcome` in `RawConfigPanel`) is
  023's to fix; if it is still present when D4 runs, D4 fixes exactly that unwrap and nothing
  else — otherwise AC 6 cannot be verified in the real UI at all.

## Plan

Bottom-up: pure tokenizer first (fully testable), then the token style layer + viewer, then
search, then the swap-in. Nothing before D4 changes an existing surface.

1. **Tokenizer** — new `src/shared/config/config-syntax.ts`:
   `tokenizeConfigText(text): ConfigSyntaxLine[]`, `ConfigSyntaxLine = { number, tokens,
   terminator }`, `ConfigSyntaxToken = { kind, text }` with
   `kind: 'comment' | 'command' | 'key' | 'cvar' | 'number' | 'string' | 'plusCommand' |
   'separator' | 'space' | 'text'`. Scanning rules copied in behaviour (not in code) from
   `config-parser.ts:110-193`: split on `\r\n|\r|\n`, `//` only outside quotes, `;` only outside
   quotes, `"…"` with no escaping and an unterminated quote running to end of line. Known commands
   as a local set (`bind`, `unbind`, `unbindall`, `alias`, `set`/`seta`/`setu`/`sets`, `exec`,
   `echo`, `wait`, `+`/`-`-prefixed → `plusCommand`). Anything unrecognised → `text`.
   Tests in `config-syntax.test.ts`, including a `renderProfileFile` output as input.
2. **Style layer** — new `src/renderer/src/styles/config-syntax.css` (imported from
   `styles/index.css` into `layer(components)`, like `controls-grid.css`): `.cfg-view`,
   `.cfg-gutter`, `.cfg-tok-*`, `.cfg-match` / `.cfg-match-current`. `@theme` tokens only.
3. **Viewer** — new `modules/config/components/ConfigCodeView.tsx`: props
   `{ text, className?, singleLine?, searchable? }`; gutter + `<pre>`; `useMemo` over `text`;
   replaces what `CodeBlock` (`components/ui/primitives.tsx:152`) did for config text.
4. **Search** — new `modules/config/lib/config-search.ts` (`findMatches(text, query)` →
   offsets; `splitTokenByMatches`) + its test; the header control (`Input` from
   `components/ui/controls.tsx`, `IconButton` for prev/next), `aria-live` count, scroll-into-view
   of the current match.
5. **Swap-in** — `RawConfigPanel.tsx` (serves both Raw File and `PreviewProfileDialog`) and
   `ImportProfileDialog.tsx`'s two snippet lists; drop `CodeBlock` if nothing imports it
   afterwards.
6. **i18n** — new `config.codeView.*` keys in `src/renderer/src/i18n/locales/en.json` (search
   label/placeholder, "n of m", no matches, next/previous, line-number gutter label).

Guardrails that apply: `src/shared` stays free of node/DOM/electron (step 1); no image assets,
tokens only (step 2); the module is never the shell (all new files under `modules/config`).

## Deliverables

- [x] **D1 — Pure Quake 2 config tokenizer.**
  Files: new `src/shared/config/config-syntax.ts`, new `src/shared/config/config-syntax.test.ts`.
  Mirror: `src/main/modules/config/core/config-parser.ts:1-193` for the scanning rules and the
  doc-header style; `src/shared/config/alt-layers.ts:32-50` for the quoting facts to cite.
  Accept: every token kind above is produced; a round-trip test reassembles the exact input for
  (a) `renderProfileFile` output, (b) a hand-written config with `alias`, `;`-chains, `//` inside
  a quoted value, an unterminated quote, a trailing comment, CRLF line ends, latin1 high-ASCII
  and one garbled line; an unrecognised line yields only `text`/`space` tokens and its neighbours
  still classify normally; a 2000-line input tokenizes well under 100 ms (loose bound, asserted);
  the file header records the GPL-3.0 finding and that nothing is derived; `src/shared` purity
  intact (no imports outside `@shared`). → AC 1, 2, 4, 5, 8

- [x] **D2 — Token style layer + read-only highlighted viewer.**
  Files: new `src/renderer/src/styles/config-syntax.css`, `src/renderer/src/styles/index.css`
  (import), new `src/renderer/src/modules/config/components/ConfigCodeView.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
  Mirror: `src/renderer/src/styles/controls-grid.css` (composed stylesheet, tokens only),
  `src/renderer/src/components/ui/primitives.tsx:152-163` (the `CodeBlock` surface it replaces).
  Accept: content renders as one `<pre>` of token spans with a `select-none`, `aria-hidden`
  line-number gutter aligned line-for-line; no soft wrap, horizontal + vertical scroll, the same
  bounded height as the old `CodeBlock`; comment italic and command semibold so kinds differ by
  more than colour; no hex value and no raw palette class in the new files; selecting the block
  and copying yields the file text without gutter numbers; high-ASCII glyphs render unchanged; a
  ~2000-line profile paints without perceptible delay and tokenization is memoized on `text`;
  `singleLine` renders one snippet with no gutter. → AC 3, 4, 5

- [x] **D3 — Find in file.**
  Files: new `src/renderer/src/modules/config/lib/config-search.ts` +
  `config-search.test.ts`, `modules/config/components/ConfigCodeView.tsx`,
  `src/renderer/src/styles/config-syntax.css`, `src/renderer/src/i18n/locales/en.json`.
  Mirror: `modules/config/ControlsTab.tsx:917-923` (filter-input idiom),
  `components/ui/controls.tsx:41` (`Input`), `components/ui/Button.tsx:68` (`IconButton`),
  `modules/config/lib/bind-conflicts.ts` (pure-helper-plus-test idiom).
  Accept: an always-visible search input in the viewer header; case-insensitive substring
  matching; "n of m" count with `aria-live="polite"`; next/previous buttons plus
  `Enter`/`Shift+Enter`, wrapping around; `Escape` clears the query and the marks; the current
  match is visually distinct from the others and scrolled into view; no match → count reads 0,
  nothing marked, no crash; a match spanning a token boundary is marked in both spans without
  altering a character, so copying is still byte-identical; `Ctrl+F` inside the viewer focuses the
  input and does not leak to the window; helper tests cover token-boundary spans, overlapping
  candidates, empty query, regex-special characters and a high-ASCII query. → AC 7 (and AC 3's
  "stays copyable" under an active search)

- [x] **D4 — One renderer in all three places.**
  Files: `src/renderer/src/modules/config/RawConfigPanel.tsx`,
  `src/renderer/src/modules/config/ImportProfileDialog.tsx:227-273`,
  `src/renderer/src/components/ui/primitives.tsx` (only to drop `CodeBlock` if it ends up with no
  importer).
  Accept: the Raw File tab and the write-preview dialog render file content through
  `ConfigCodeView` (the per-file path/badge/reveal header from 023 untouched); the import
  preview's preserved-line and duplicate-bind snippets render through the same component's
  `singleLine` variant; a grep for `CodeBlock` over `src/` leaves either no importer and the
  primitive removed, or exactly one named in the Done section with its reason; if the pre-existing
  double-unwrapped-`Outcome` crash on `config-raw` is still present, it is fixed by that one
  unwrap and nothing else; build + typecheck + tests green. → AC 6

## Model Hints

- D2 → `deliverable-hard` — it is the only D whose real constraints cannot be unit-tested in this
  repo (vitest is node-only): copy-yields-the-original-bytes, a gutter that stays aligned without
  wrapping, and 2000 lines without virtualization all fail *silently* if they are got wrong.
- D1, D3, D4 → default tier (pure logic with its own tests; a pure search helper plus a small
  control; a three-call-site swap).
- Review: → `story-review-hard` — byte-fidelity of a read-only view is exactly the kind of
  regression tests here cannot catch, and D4 edits `RawConfigPanel.tsx` while story 023 rewrites
  it in the same sprint.

## Test Plan (manual acceptance)

`npm run dev`, then:

1. Config → a profile with a few binds, cvars, an alias and a comment → **Raw file** tab, pick an
   installation. The file is highlighted: comments dim + italic, `bind`/`set`/`alias` semibold,
   key names, cvar names, numbers and `"quoted strings"` each in their own colour, `+attack`
   marked as a `+`-command. Line numbers on the left.
2. Select the whole block, copy, paste into a text editor: exactly the file's text, no line
   numbers, no reformatting, nothing trimmed.
3. Controls → put a symbol-picker message (high-ASCII glyphs) into a bind, save, back to Raw
   file: the glyphs render unchanged and the rest of the line still highlights.
4. Add a deliberately garbled line to a bind command (or import a config that has one): that line
   shows as plain text, the lines around it stay highlighted.
5. Type a key name (e.g. `MOUSE1`) into the search box: the count reads "n of m", matches are
   marked, the current one stands out and is scrolled into view. `Enter` / `Shift+Enter` step
   forward and back and wrap. Type something absent → "0". `Escape` clears. Copy the block again:
   still byte-identical.
6. Scroll a large profile (assign a ~2000-line imported config if available): no stutter, gutter
   stays aligned with the lines, long lines scroll horizontally instead of wrapping.
7. Profiles list → **Preview** on an assigned profile: the dialog shows the same highlighted
   viewer, with search.
8. New profile → **Import from installation** → pick an installation and gamedir: preserved lines
   and duplicate binds in the preview are highlighted by the same renderer.
9. `npm run ui:verify` — `config-raw` screenshots at both viewports render the highlighted view
   and audit clean (aside from the shell-level `page-has-heading-one` finding shared by every
   `config-*` screen).

## Done

Implemented across 4 deliverables (D1-D4): a pure, lossless, positional Quake II config
tokenizer (`src/shared/config/config-syntax.ts` — no imports beyond nothing, no coupling to
`config-parser.ts`/`cvar-catalog`/`key-names`) with a licence-provenance header naming the
reference extension's GPL-3.0 status and the non-derivation claim; a token-styled, gutter'd,
non-wrapping, memoized `ConfigCodeView` viewer (`src/renderer/src/modules/config/components/
ConfigCodeView.tsx`, `styles/config-syntax.css`, new `--color-cfg-*` `@theme` tokens in
`styles/index.css`) with an always-visible find-in-file header backed by a pure
`modules/config/lib/config-search.ts` helper (case-insensitive substring search, token-boundary-
safe highlighting, container-scoped `Ctrl+F`/`Escape`, wrapping next/prev, `aria-live` count);
and a swap-in that replaced `CodeBlock` at all three real call sites — `RawConfigPanel.tsx`
(searchable, multi-line), `RawFileTab.tsx`'s canonical-file block (a third `CodeBlock` usage
the plan's two named files didn't list but AC 6's own "in Raw File" wording covers), and
`ImportProfileDialog.tsx`'s two snippet lists (`singleLine`) — after which `CodeBlock` had zero
remaining importers and was deleted from `primitives.tsx`.

**Decisions (during build):**
- D1's own instructions (written by this build's orchestrator, not the story text) initially
  over-restricted `plusCommand` to a segment's first word, which the review caught as making the
  kind dead for the story's own test-plan example (`bind s +back`). Fixed in the review-fix cycle
  by matching `+`/`-` followed by a letter regardless of word position (excluding numeric values
  like `-5`), without touching the more specific `command`/`key`/`cvar` classifications that take
  priority. This is a build-process note, not a story-plan gap — the story's own AC/Plan text
  never named the "first word only" restriction.
- The find-in-file search re-renders all tokens on every keystroke (tokenization itself stays
  memoized on `text` only, per the story's own no-virtualization decision); the review flagged
  this as a PLAUSIBLE, unmeasured concern, not a confirmed defect, and it was left as-is —
  fixing it would mean adding per-line memoization the story never asked for, and the story's own
  performance guarantee is scoped to painting the file, not to every search keystroke.
- `ImportProfileDialog.tsx`'s snippet rows lost their old `truncate`/`title` overflow handling in
  the initial D4 swap (since `ConfigCodeView`'s `singleLine` mode scrolls horizontally by design);
  fixed in the review-fix cycle by wrapping each snippet in a `title`-carrying, `overflow-hidden`
  container instead of changing `ConfigCodeView` itself.

**Verification:** `npm run build`, `npm test` (863 tests, 47 files), `npm run typecheck` all
green, both before and after the review-fix cycle. `npm run ui:verify`: `config-raw` renders
cleanly at both viewports with the gutter correctly hugging the line numbers (the CSS grid
track-sizing bug the review caught is visibly fixed in the screenshot) and only the pre-existing
baseline moderate `page-has-heading-one` finding shared by nearly every config screen (no new
console errors or axe criticals); `config-list` and `keybind-dialog`'s pre-existing critical
findings are unrelated screens this story never touches. The write-preview dialog and import
preview are not part of the automated `ui:verify` screen set (pre-existing harness scope, not a
gap introduced here); their manual acceptance is covered by `## Test Plan` steps 7-8, which
still need a human `npm run dev` pass to fully confirm since a headless session cannot drive a
modal dialog through this harness.

Code review (`story-review-hard`): first pass **FAIL** — 6 confirmed findings (the `plusCommand`
position bug; a CSS grid track-sizing bug that let the gutter column absorb nearly all free
width, verified visually before/after in the live-smoke pass; an Escape handler that swallowed
the key even with an empty query, which would have blocked closing an ancestor modal; a
match-count label that could drift from the actual clamped/highlighted match; a `Ctrl+F` handler
unreachable unless focus was already inside the search box; and the `ImportProfileDialog`
truncation regression above) plus 2 non-blocking notes (stale pre-fix screenshots, since
addressed by re-running `ui:verify`; the PLAUSIBLE per-keystroke re-render noted above). All 6
confirmed findings fixed in one review-fix cycle; build/test/typecheck re-verified green after.
No second formal review pass was run (as with story 023, the workflow requires re-verification
after a fix cycle, not necessarily a second review pass), but each fix was checked directly
against the reviewer's own file:line evidence before accepting.

**Commit message:** `024: add Quake 2 config syntax highlighting with find-in-file`

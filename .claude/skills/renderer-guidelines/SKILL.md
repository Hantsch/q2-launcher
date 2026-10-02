---
name: renderer-guidelines
description: "Architecture, state and reuse rules for the React renderer of an Electron app organised as shell + modules. Use when: creating or editing files under an Electron renderer source tree; adding a view, tab, dialog, hook or list block to a renderer module; reading main-owned data in the renderer or wiring a subscription to a main-to-renderer event; applying a mutation whose result can be refused by main; deciding whether something is component state, context, a module store or a query hook; adding a UI-kit primitive (dialog, tab strip, menu, toast, error boundary); splitting a large component; writing a renderer unit or component test; reviewing a renderer diff for duplication, misplaced files, cross-module imports or hand-rolled effects. DO NOT USE FOR: web-only React apps with routing, pages and a server-state library (use frontend-guidelines); main-process or preload code (use electron-arch); IPC contract mechanics (use typed-ipc); colours, focus rings and target sizes (use design-tokens)."
---

<!-- tech-rules:managed 2.3.0 -->

# Renderer Guidelines for Electron

The renderer of an Electron app is a React tree with no server, no router worth the name and one
data source: the main process, reached through a typed bridge. Web frontend rules about pages,
routes and server-state libraries do not bind here, so the duplication they would prevent arrives
unopposed - the same read-on-mount effect 36 times in 26 files, name dialogs that differ in two
i18n keys, one component that kept growing because nothing said where its parts belong. These rules
say where they belong.

**Precedence:** project-specific overrides (paths, store library, test runner) belong in the host
repo's `CLAUDE.md` and take precedence over this skill. Colours, focus states and target sizes are
`design-tokens`' business; the typing of the bridge and of a module's client is `typed-ipc`'s.
Neither is repeated here.

## 1. The shape: a shell and modules

```
src/renderer/src/
  App.tsx, main.tsx          shell: app frame, navigation, boot
  components/shell/          shell chrome (title bar, nav rail, status strip)
  components/ui/             the UI kit - every primitive below lives here
  store/                     the shell's global store: boot state, route, mirror of shell-owned main data
  hooks/                     the shell's shared React hooks: useModuleQuery, useModuleMutation (see 2.)
  lib/                       shell-level React-free helpers
  test/                      shared test support: fixture builders, bridge stub, renderWithProviders
  i18n/                      bundle setup; locale files, one per module where the project splits them
  modules/
    index.ts                 the module registry: id -> { View, settingsSection?, Dialogs? }
    <module>/
      index.ts               registers the module's slots with the registry - nothing else
      public.ts              what other modules may import from this one; absent = nothing
      client.ts              named wrappers, one per handler, over the typed bus client (see typed-ipc)
      <Module>View.tsx       the view that owns the module's route; tabs beside it
      components/            presentational and row-level components
      dialogs/               modals, each on NameDialog / ConfirmDialog / Modal
      hooks/                 use*.ts - state and effects, camelCase files
      lib/                   React-free: parsers, derivations, sort/filter, pure helpers
      store.ts               a module store, only when state crosses two views (see 2.)
```

**Placement rule.** A file goes to the narrowest folder that fits: React-free code to `lib/`
(testable with no DOM); state and effects to `hooks/`; a modal to `dialogs/`; everything else that
renders to `components/`. The view and its tabs are the only components at a module's root. A
component that imports from `react` does not belong in `lib/`; a hook that renders does not belong
in `hooks/`. The same split holds at the shell level: the shared `useModuleQuery` /
`useModuleMutation` live in the shell's `hooks/`, and the shell's `lib/` stays React-free.

**Two hard import rules**, asserted by the project's layering test - the one tree-walking test
`electron-arch` describes covers the renderer tree as well, so the renderer does not get a second
one (a linter may mirror the rules so they show while typing):

- **The shell never imports a module's internals.** It reaches a module only through the registry
  in `modules/index.ts` - the module hands over its `View`, its settings section and its dialogs
  there, and the shell mounts what it is given without knowing what it is. A shell file importing
  `modules/<x>/components/...` is a finding.
- **A module never imports another module except through its `public.ts`.** No `public.ts` means
  nothing is shared on purpose. Code two modules need moves down to `src/shared/` (pure) or the
  shell's `lib/` / `hooks/` (renderer-level), never sideways.

Any other cross-module import is an entry on that test's allowlist, naming the story or decision
that allows it; the test refuses an entry without one, and the allowlist only shrinks - the same
rule as in the main tree.

## 2. State: four kinds, one rule each

| The data is... | It lives in... | Never in... |
| --- | --- | --- |
| Owned by main (lists, snapshots, settings) | the shared query hook, or the shell store's mirror for shell-owned data | a per-component `useEffect` + `useState` pair |
| Renderer-only, read by two or more views of one module | a module store (`store.ts`, the project's store library) | the shell's global store; props threaded through three levels |
| A handle a subtree shares (selected profile, draft, patch function) | a context provider mounted once at the subtree root | a four-prop contract repeated on every tab |
| Anything else | component state | a store |

The shell store holds shell state: boot, route, the mirror of what main pushes for the shell. A
module's list does not go there - the review that motivated this skill found one global store with
every module's data in it.

**Main-owned data is read through one hook.** It owns cancellation, StrictMode double-mount,
subscription and reload once, so no component does. Its contract - not an implementation:

```ts
/** One-shot read, optional live subscription, explicit reload. */
useModuleQuery<T>(
  read: () => Promise<Outcome<T>>,
  options?: { subscribe?: (next: (value: T) => void) => () => void; deps?: unknown[] },
): { state: 'loading' | 'error' | 'success'; data: T | undefined; error: unknown; reload: () => void }

/** One mutation; settles transport failure and domain refusal into one result. */
useModuleMutation<I, R>(
  apply: (input: I) => Promise<Outcome<R>>,
  toKey: (refusal: Outcome<R> | R) => string,   // the i18n key the user sees
): { run: (input: I) => Promise<R | undefined>; busy: boolean; errorKey: string | null }
```

`data` survives a `reload()` so a refetch does not flash a filled panel back to empty. `busy`
disables the control that started the mutation - every mutation, not the ones whose author
remembered. Both hooks are unit-tested for unmount-before-resolve, StrictMode double mount, a
refused mutation and a transport failure; the components that use them are not tested for those
again.

**A hand-rolled `let cancelled = false` effect is a finding.** So is `const [submitting,
setSubmitting]` beside an IPC call, and a `mutate` helper that maps `Outcome` to a key inside a
component. The hook exists; use it. Where a view already has a generic loading/error/retry hook of
its own, it is the shared one under a local name - promote it, do not write a second.

## 3. Mandatory primitives for a desktop renderer

A desktop app has few interaction shapes and uses each of them dozens of times. The kit in
`components/ui/` owns them; a dialog or tab strip hand-built outside it is a finding, not a style
choice, because the next keyboard or focus fix would then be twelve edits instead of one.

| Primitive | Owns |
| --- | --- |
| `Button`, `IconButton` | every clickable rectangle; `IconButton` always carries `aria-label` |
| `Modal` | the overlay: focus trap, `Escape`, backdrop click, one open at a time |
| `NameDialog` | "give it a name": focus in the field on open, one `canSubmit` gating both the button and Enter, `maxLength`, optional `validate` |
| `ConfirmDialog` | "are you sure": title, body, confirm label, `tone`, `busy` |
| `Tabs` | `role="tablist"`/`tab`/`tabpanel`, roving tabindex, arrow keys |
| `Menu` | context and kebab menus: items, separators, keyboard navigation |
| `Field`, `Input`, `TextArea`, `Select` | the only form controls; raw `<input>`/`<textarea>`/`<select>` appear inside these files only |
| `RadioGroup` | a choice of one; raw `type="radio"` inside it only |
| `Toast` | the one non-modal failure and confirmation surface (see 6.) |
| `ErrorBoundary` | the only boundary class, with `fallback`, `resetKeys` and `scope`; a module mounts it with its own `scope` and `fallback`, never a copy of the class |

`NameDialog` exists because its copies drifted: one submitted twice on Enter, one gated the button
but not the key. `Tabs` exists because the hand-rolled strips had `role="tablist"` in none. The
kit's primitives have unit tests of their own; a consumer tests its behaviour, not the primitive's.

## 4. The rule of three, across the whole tree

Before writing a hook, a dialog, a row parser or a list block: search the whole renderer for the
shape, not the surrounding JSX. Grep for its distinctive line - the `useEffect` + `invoke` pair,
the `[name, setName]` + `[submitting, setSubmitting]` pair, the `title + body + variant="danger"`
footer - and count.

- **One copy exists:** reuse it or extend it. Do not write a near-copy and point at the original.
- **Two copies exist:** the third is not written. Extract the helper first (name its target path:
  `lib/`, `hooks/`, `components/ui/`, `src/shared/`), migrate the two, then use it.
- **The helper exists but the copies stayed:** that is the finding to fix before adding a caller.

"Mirrors X exactly" in a comment is the smell, not a justification: it records that the author saw
the duplicate and copied it anyway. A comment states the invariant or the non-obvious why; a story
pointer is a trailing `(story 042)` at most, never a deliverable or review-round id.

## 5. Component size and effects

- **A view composes.** It mounts a provider, reads hooks, lays out components. Interactive state
  lives in `hooks/`; derivations in `lib/`. A view with a 400-line `return` is a view doing its
  components' job.
- **Past ~400 lines or ~12 state atoms, split.** Not a style threshold: at that size a component is
  holding more than one concern, its tests need a 120-280-line preamble to mount it, and a fix to one
  row path misses the other. Split along the seams that already exist - the row, the drag state,
  the dialogs, the derived-rows pipeline.
- **Reset on identity change via `key`, not an effect.** `<Detail key={selected.id} />` resets
  every atom in one tick; `useEffect(() => { setA(..); setB(..) }, [selected.id])` resets them one
  render late and has to be kept in sync by hand. A `setState` inside an effect that only mirrors a
  prop is a finding.
- **Derived rows are memoised.** Sort, filter and group run in one `useMemo` keyed on their inputs,
  once per change - not once per render for every row. A hundreds-of-rows list that re-sorts on an
  unrelated keystroke is the symptom.
- **Dialog state is one discriminated union**, not one boolean per dialog: `{ kind: 'none' } |
  { kind: 'rename'; id } | ...`. One open at a time by construction.

## 6. Failure surfaces

Every refused or failed mutation reaches the user through one surface: the `Toast` primitive, or
the inline helper text a form field owns. Not `console.error`, not a swallowed `Outcome`, not an
alert. The mutation hook gives the component the translated key; the component renders it through
the kit.

- A refusal from main is a key (`servers.watchlist.error.duplicate`), never prose - main does not
  know the user's locale (see 7.).
- A transport failure (the bridge rejected) is a bug, and renders as one: the module's generic
  `...error.failed` key plus a log line with the `Error`.
- **The renderer never assembles an i18n key by template.** `` t(`${prefix}.error.${code}`) ``
  defeats extraction and hides a missing key until a user hits it. Map codes to keys in one
  explicit table in `lib/`, exhaustively typed, and let the type checker find the missing case.
- An `ErrorBoundary` fallback is the surface for render crashes, scoped per module so one module's
  crash leaves the rest of the app usable; its strings are deliberately not translated, because the
  i18n bundle may be what broke.

## 7. Strings

User-visible strings live in the renderer's i18n bundle; where the project splits the bundle, each
module owns its locale file (`modules/<module>/locales/<lang>.json`, or a namespace in the shared
file) and its keys share the module's prefix. Main sends keys across IPC, never prose - the
renderer is the only side that knows the locale, so a `reasonKey` in an `Outcome` is translated at
the surface in 6., not in the handler. A hardcoded user-facing string in JSX is a finding
(`ErrorBoundary`'s fallback excepted, for the reason above).

## 8. Testing in the renderer

- **Shared test support in `src/renderer/src/test/`** (or the module's `test/` for module-shaped
  fixtures): fixture builders (`installationFixture(overrides)`, `profileFixture(overrides)`), a
  bridge stub (`stubBridge({ 'x:y': () => ok(value) })`) that fails on an unexpected channel, and
  `renderWithProviders(ui, { store?, locale? })`. A test file that declares its own fixture builder
  or `window.<bridge>` stub while the shared one exists is a finding - seven suites each carrying
  120-280 lines of private preamble is what this rule prevents.
- **`@testing-library/react` only.** One mounting idiom; no second renderer, no snapshot tests of
  whole views.
- **`describe` and `it` name behaviour**, never a story or deliverable: `describe('NameDialog')` /
  `it('submits once on Enter')`, not `describe('story 045')`. A test file is a specification of
  the component beside it, not a chronological log.
- **Hooks are tested with `renderHook`** on the four cases in 2.; components are tested for what
  they render and what they call, with the bridge stub recording the calls.
- A `lib/` file needs no DOM in its test. If it does, it is not `lib/`.

## Forbidden patterns (hard rules)

- A shell file importing anything under `modules/<x>/` other than through the registry.
- A module importing another module's file that is not its `public.ts`.
- `useEffect` + `useState` + `invoke` in a component to read main-owned data; `let cancelled = false`.
- `[submitting, setSubmitting]` or an inline `Outcome`-to-key mapper beside a mutation call.
- A modal, confirm, name prompt or tab strip built outside `components/ui/`.
- A second `getDerivedStateFromError` class anywhere.
- `setState` inside an effect that mirrors a prop; resetting on identity change without `key`.
- Sort/filter/group of a list computed in render without `useMemo`.
- An i18n key built by string template; a hardcoded user-facing string.
- A third copy of any shape; a "mirrors X exactly" comment; deliverable or review ids in comments.
- A test file with its own fixture builder or bridge stub while the shared support exists;
  `describe('story NNN')`.
- Raw `ipcRenderer`, `require`, `node:*` or a hardcoded channel string in the renderer (that is
  `electron-arch` and `typed-ipc` territory, listed here because it is where it would be typed).

## Naming cheat sheet

| Thing | Convention | Example |
| --- | --- | --- |
| Component and file | PascalCase | `WatchlistRow.tsx` |
| View | `<Module>View` at the module root | `ServersView.tsx` |
| Hook and file | `use` + camelCase | `hooks/useWatchlist.ts` |
| Module client | `client.ts`, one named wrapper per handler, verb named after it; components import the wrappers and never call the bus with a handler string | `readWatchlist`, `addWatchlistEntry` |
| Module store | `store.ts`, exported as `use<Module><Thing>` | `useConfigProfiles` |
| Context | `<Thing>Provider` + `use<Thing>Context` | `ProfileDraftProvider`, `useProfileDraftContext` |
| React-free helper | camelCase file under `lib/` | `lib/bindConflicts.ts` |
| i18n key | `<module>.<view>.<key>`; refusals under `<module>.<thing>.error.<code>` | `servers.watchlist.error.duplicate` |
| Test | beside the file, `<Name>.test.ts(x)`, describes named by behaviour | `NameDialog.test.tsx` |

## Review checklist

- [ ] Every new file sits in the folder the placement rule names; `lib/` imports no `react`; the shared query/mutation hooks sit in the shell's `hooks/`
- [ ] The shell reaches modules only through `modules/index.ts`; no module imports another outside `public.ts`; any exception is an allowlist entry in the layering test naming its story or decision
- [ ] Main-owned data is read through the shared query hook; mutations through the mutation hook; no `let cancelled = false`
- [ ] State kind matches the table in 2.: query hook / module store / context / component state
- [ ] Dialogs, confirms, name prompts and tab strips come from `components/ui/`; one `ErrorBoundary` class
- [ ] The diff adds no block that already exists elsewhere in the tree (searched by distinctive line); the third copy extracted the helper
- [ ] No "mirrors X exactly" comment; comments state the invariant, not the story history
- [ ] No component past ~400 lines or ~12 state atoms; resets via `key`; derived rows memoised
- [ ] Every refused or failed mutation reaches the user through `Toast` or field helper text with a translated key
- [ ] No i18n key built by template; no hardcoded user-facing string; main sent keys, not prose
- [ ] Tests use the shared fixture builders, bridge stub and `renderWithProviders`; describes named by behaviour
- [ ] Colours, focus and target sizes checked against `design-tokens`; the client's typing against `typed-ipc`
- [ ] Project-specific rules in the repo's `CLAUDE.md` respected - they override this skill

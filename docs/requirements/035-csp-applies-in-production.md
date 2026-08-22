---
id: 035
title: The Content-Security-Policy actually applies in a production build
status: ready
created: 2026-08-21
---

## Requirement

The launcher ships a strict CSP as defence in depth (`applySecurityPolicies()` in
[src/main/index.ts](../../src/main/index.ts#L84), the production policy at line 88), but in a
packaged build that policy never reaches the renderer. The header is injected through
`session.defaultSession.webRequest.onHeadersReceived`, and that hook does not fire for
`file://` loads — which is exactly how the production renderer is loaded
(`window.loadFile(join(__dirname, '../renderer/index.html'))`,
[src/main/window.ts:196](../../src/main/window.ts#L196)). So the whole policy is live in `npm
run dev` (where the Vite dev server serves over HTTP) and silently absent in the build users
actually run. This was found while closing story 028 and has never been filed.

Two things are wrong and only the second one is cosmetic:

1. The renderer runs without the CSP it was designed around. A compromised dependency in the
   renderer bundle has no `script-src`/`connect-src`/`object-src` restriction stopping it.
2. Nothing tells us. A security guardrail that fails open and stays quiet is worse than not
   having it, because the roadmap and the code both claim it is there.

The roadmap already names the fix under "Hardening" — serve the production renderer from a
privileged `app://` scheme instead of `file://` (Electron security checklist item 18). That
makes the renderer a real HTTP-like origin, which is what the header hook, and a handful of
other browser-security defaults, need in order to work at all. This story is that change plus
proof that the policy is in force.

Scope boundary: this is the loader and the policy plumbing, not a policy rewrite. If the move to
`app://` means the production policy can be *tightened* (e.g. dropping `'unsafe-inline'` from
`style-src` once Tailwind's emitted stylesheet is a real file request), that is a welcome
side effect but not the goal — the goal is that the policy on the books is the policy in force.

## Acceptance Criteria

- [ ] A packaged/production renderer loads from a privileged custom scheme (not `file://`), and
      the window's own document origin reflects it.
- [ ] The production CSP is verifiably present on the renderer document in a production build —
      not just registered in code. "Verifiably" means an observable check, e.g. reading the
      applied policy from the loaded document, not "the callback ran".
- [ ] Dev mode keeps working unchanged: HMR, React Fast Refresh, the websocket connection and
      the dev-only relaxations in the dev policy.
- [ ] Everything the renderer loads still loads: the generated app icon, fonts, inline SVG,
      any `data:`/`blob:` use already in the code — no blank surfaces, no console CSP
      violations on any screen `npm run ui:verify` visits.
- [ ] `npm run ui:verify` passes in whichever mode it drives the app, with no new violations
      and no new console errors.
- [ ] If the change makes a CSP directive redundant or lets one be tightened, the policy string
      is updated and the reason is a comment next to it.
- [ ] A regression guard exists so this cannot fail open silently again — the honest minimum is
      a test or startup assertion that fails if the renderer document has no CSP in a
      production build.

## Decisions (Sprint)

- **(User)** Build mode `ui:verify` drives: production-mode build, so the CSP acceptance check
  is real (also settles the same question for story 037).
- **(User)** Custom scheme name: `q2launcher://` (project-specific, not the generic `app://`).
- **(User)** `style-src 'unsafe-inline'` tightening: stays a separate follow-up; this story only
  makes the policy on the books the policy in force.
- The mode that decides *loading + CSP* is derived from the **dev server**, not from `is.dev`:
  `ELECTRON_RENDERER_URL` present → dev server + dev policy, otherwise → `q2launcher://` +
  production policy. Reason: `is.dev` is `!app.isPackaged`, so today the harness runs the *dev*
  policy over a `file://` load — a third mode nobody designed — and deriving from the dev server
  makes `ui:verify` drive production mode with no new flag.
- `is.dev` stays the source of truth for everything else it decides today (dev-only IPC
  registration, `appInfo.isDev`). Reason: those are about an unpackaged developer build, not about
  where the renderer document comes from, and changing them would alter harness behaviour this
  story has no business touching (the Settings dev button stays visible under the harness, as
  today).
- `childEnv()` in the harness also deletes `ELECTRON_RENDERER_URL`. Reason: without it a developer
  who has that variable exported would silently flip `ui:verify` back into dev mode — production
  mode has to be a guarantee, not a coincidence (story 037 depends on the same guarantee).
- URL shape `q2launcher://app/index.html` (host `app`). Reason: a `standard: true` scheme needs a
  host to form an origin, and `q2launcher://app` is what `'self'` then resolves to.
- Scheme privileges kept minimal: `standard`, `secure`, `supportFetchAPI`. Reason: `standard` gives
  the origin and the relative-URL resolution the built `./assets/...` tags need, `secure` makes it
  a secure context, `supportFetchAPI` is what lets the CSP check fetch the document back; `stream`
  and `codeCache` buy nothing for a handful of small local files.
- The protocol handler reads the file with `readFile` and builds the `Response` itself (explicit
  extension→MIME map) instead of delegating to `net.fetch(file://…)`. Reason: the renderer bundle
  is a few hundred KB of small local files, and an owned response makes the content type and the
  CSP header deterministic **and** unit-testable without Electron.
- The production CSP is attached **in the protocol handler**, and `onHeadersReceived` is registered
  only in dev-server mode. Reason: the handler is the only thing that serves the production
  document, so the policy travels with the response instead of with a hook that may or may not
  fire.
- No `<meta http-equiv="Content-Security-Policy">` in `index.html`. Reason: a meta fallback would
  paper over exactly the failure this story exists to make impossible to miss.
- AC6 resolves to a *comment*, not a policy change: nothing becomes redundant (`'self'` starts
  meaning something for the first time) and the one tightenable directive is the deferred
  `style-src 'unsafe-inline'`. The deferral gets a bullet under ROADMAP "Hardening" rather than a
  new story file — that is where the other unsprinted hardening items live.
- AC5 is read as *no new* failures against the pre-change baseline. Reason: `ui:verify` is
  documented as exiting non-zero today (the `config-raw` renderer crash, plus known axe findings);
  making the full run green is story 037's job, not this one's.
- `/electron-arch`'s checklist line "`will-navigate` blocks anything outside the dev server /
  `file://`" needs no CLAUDE.md deviation entry. Reason: the rule is "block navigation away from
  your own content", and `q2launcher://app/` *is* our own content — `file://` is the example's
  default loader, not the rule.

## Open Questions

- ~~Does the harness (`npm run ui:verify`) drive a production-mode build or a dev-mode one? …~~
  answered → Decisions (Sprint)
- ~~`app://` vs. a project-specific scheme name (`q2launcher://`) …~~ answered → Decisions (Sprint)
- ~~Should the production policy be tightened in the same story …~~ answered → Decisions (Sprint)

## Plan

One new pure module owns the scheme, the two policy strings and the request handler; the shell
(`index.ts`, `window.ts`) only wires it up; the harness then asserts the result on every run.

1. **`src/main/lib/renderer-source.ts` (new, no `electron` import)** — the whole decidable part:
   - `RENDERER_SCHEME = 'q2launcher'`, `RENDERER_HOST = 'app'`, `RENDERER_ORIGIN`,
     `RENDERER_INDEX_URL = 'q2launcher://app/index.html'`.
   - `DEV_CSP` / `PRODUCTION_CSP`, moved verbatim from `index.ts:85-88`, with the AC6 comment next
     to the production string (why `style-src 'unsafe-inline'` stays, pointing at the follow-up).
   - `resolveRendererSource({ isDev, devServerUrl })` → `{ kind: 'dev-server', url } | { kind: 'scheme' }`
     — the single mode decision both `index.ts` and `window.ts` read.
   - `createRendererProtocolHandler({ root, csp, readFile })` → `(request) => Promise<Response>`:
     empty/`/` path → `index.html`; reject a foreign host and anything resolving outside `root`
     (404, no body); `readFile` + explicit MIME map (`.html .js .css .woff2 .svg .png .ico
     .json`); every response carries `Content-Security-Policy: csp`.
2. **`src/main/index.ts`** — `protocol.registerSchemesAsPrivileged([...])` at module top level
   (must run before `app.whenReady()`); in `bootstrap()`, for `kind: 'scheme'`,
   `protocol.handle(RENDERER_SCHEME, handler)` with `root = join(__dirname, '../renderer')`, then
   assert `protocol.isProtocolHandled(RENDERER_SCHEME)` and log the resolved source once;
   `onHeadersReceived` now registered only for `kind: 'dev-server'`. Permission handler untouched.
3. **`src/main/window.ts`** — `loadURL(RENDERER_INDEX_URL)` instead of `loadFile(...)`, and
   `will-navigate` allows `RENDERER_ORIGIN + '/'` instead of `file://` (that also keeps the
   harness's `page.reload()` and the ErrorBoundary's `location.reload()` working).
4. **`scripts/lib/harness.mjs`** — `childEnv()` also deletes `ELECTRON_RENDERER_URL`; after
   `waitForLoadState('domcontentloaded')`, beside the existing userData containment assert, check
   `location.origin === 'q2launcher://app'` and that `fetch(location.href)`'s
   `content-security-policy` header is present and contains `script-src 'self'` — a `HarnessError`
   naming the failure otherwise. Every entry point (`ui:shot`/`ui:a11y`/`ui:verify`/`ui:flow`/
   self-check) inherits it.
5. **Docs** — `docs/UI-VERIFICATION.md` gains a short "Production-mode guarantee" section (what
   the harness now asserts, and why `ELECTRON_RENDERER_URL` is stripped); `docs/ROADMAP.md`
   "Hardening" gains the `style-src` follow-up bullet.
6. **Evidence** — `npm run dev` (HMR/Fast Refresh still alive) plus a full `npm run ui:verify`,
   compared against the documented pre-change baseline.

## Deliverables

- [ ] **D1 — Pure renderer-source module + unit tests.** New `src/main/lib/renderer-source.ts`
      (constants, `DEV_CSP`/`PRODUCTION_CSP` moved verbatim, `resolveRendererSource`,
      `createRendererProtocolHandler`) and new `src/main/lib/renderer-source.test.ts` (mirror
      `src/main/lib/schemas.test.ts` for style). No `electron` import in either file.
      *Acceptance:* `npm test` + `npm run typecheck` green; tests prove that `index.html` and an
      asset both come back 200 with the production CSP header and the right content type, that
      `/` maps to `index.html`, that `../` traversal and a foreign host give 404 with no body,
      that a missing file gives 404, and that `resolveRendererSource` picks `dev-server` only
      when `isDev` **and** a dev-server URL are both present.
- [ ] **D2 — Serve the production renderer from `q2launcher://` and attach the CSP there.**
      `src/main/index.ts` (privileged-scheme registration at module top level, `protocol.handle`
      plus the `isProtocolHandled` boot assertion and one log line, `onHeadersReceived` only in
      dev-server mode, policy strings imported instead of inlined) and `src/main/window.ts`
      (`loadURL(RENDERER_INDEX_URL)`, `will-navigate` allowlist).
      *Acceptance:* `npm run build` + `npm run typecheck` + `npm test` green; a production-mode
      launch renders the app (no blank window, no missing stylesheet — the built tags are
      `./assets/...` with `crossorigin`) and reports `location.origin === 'q2launcher://app'`;
      `npm run dev` still loads from the dev server with the dev policy.
- [ ] **D3 — The harness proves it, every run.** `scripts/lib/harness.mjs` (`childEnv()` deletes
      `ELECTRON_RENDERER_URL`; origin + CSP assertion beside the existing `assertInside` check on
      the userData path the app reports) and `docs/UI-VERIFICATION.md` ("Production-mode
      guarantee").
      *Acceptance:* `npm run ui:verify -- --screens=home` passes; temporarily removing the CSP
      header from the handler makes it fail with a message naming the missing policy (verified by
      hand, not left in the tree); `node scripts/lib/harness.mjs` self-check still passes.
- [ ] **D4 — Evidence + the deferred follow-up.** A full `npm run ui:verify` run and a
      `npm run dev` smoke, both recorded in the Done section against the pre-change baseline (the
      known `config-raw` crash and the known axe findings are 037's, not new); `docs/ROADMAP.md`
      "Hardening" gains the `style-src 'unsafe-inline'` follow-up bullet.
      *Acceptance:* the Done section names every screen whose verdict changed (expected: none) and
      confirms zero new console CSP violations; the ROADMAP bullet is present.

## Model Hints

- D1 → default
- D2 → **deliverable-hard** — the one change that can fail only in the *packaged* build: scheme
  registration has to happen before `app.whenReady()`, the renderer root is asar-relative, the
  privilege flags decide whether `./assets/...` and `fetch` resolve at all, and the
  `will-navigate` allowlist has to keep both `page.reload()` and the ErrorBoundary reload alive —
  a mistake in any one of them shows up as a blank window, not as a type error.
- D3 → default
- D4 → default
- Review: → **story-review-hard** — a security guardrail that has already failed open once; the
  review has to judge whether the policy is genuinely *enforced* and the path guard genuinely
  *contains*, not whether the diff compiles.

## Test Plan (manual acceptance)

The app itself is the surface here — "it renders, from the new origin" is the acceptance.

1. `npm run dev` — the launcher opens; edit any visible string in a renderer view and save: the
   change appears without a reload (HMR + Fast Refresh alive) and the DevTools console shows no
   CSP violation. Close it.
2. `npm run build && npm run ui:verify` — the summary says `run: full`, the harness does not abort
   with a CSP/origin error, and no screen's verdict is worse than in the baseline run recorded
   before the change. Flip through `.ui-verify/screenshots/` — no blank surfaces; fonts and
   inline-SVG icons render as before.
3. `npm run package:dir`, then launch `release/<version>/win-unpacked/Q2 Launcher.exe` — the
   window renders, navigation between modules works, and an external link still opens in the
   browser. Check the launcher log (`%APPDATA%\q2-launcher\logs\`) for the one startup line naming
   `q2launcher://app` as the renderer source; that is the packaged-build evidence, since the
   header-level proof is the harness assertion from step 2.

## Done

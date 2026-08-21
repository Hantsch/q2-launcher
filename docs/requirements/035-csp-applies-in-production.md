---
id: 035
title: The Content-Security-Policy actually applies in a production build
status: draft
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

## Open Questions

- Does the harness (`npm run ui:verify`) drive a production-mode build or a dev-mode one? If
  dev-mode, the CSP acceptance check needs its own path — a "production" run of the harness, a
  unit test against the scheme handler, or a documented manual step. Do not fake it by asserting
  the dev policy.
- `app://` vs. a project-specific scheme name (`q2launcher://`): does anything in the repo
  (deep-link plans, `openExternal` allowlist, the preload allowlist) prefer one?
- Should the production policy be tightened in the same story once `style-src 'unsafe-inline'`
  is no longer needed, or is that a separate follow-up with its own acceptance pass?

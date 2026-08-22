---
id: 046
title: The production CSP no longer allows inline styles
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Story 035 moved the shipped renderer onto a real `q2launcher://` origin and made the CSP travel
with every protocol response — but it deliberately left one directive unresolved:
`style-src 'self' 'unsafe-inline'`. That single token means any injected `<style>` block or
`style="..."` attribute still executes, which is exactly the class of attack the whole CSP exists
to stop. The repo's own security claim is therefore still one directive short of true, and the
roadmap has carried it as a ready follow-up ever since.

Nothing blocks it any more: Tailwind's output is requested as a real `./assets/*.css` file, not
inlined. What is unknown is how many inline `style={{ ... }}` usages the renderer still has and
whether any third-party dependency injects a stylesheet at runtime.

## Acceptance Criteria

- [ ] The production CSP in `src/main/lib/renderer-source.ts` has no `'unsafe-inline'` in
      `style-src`.
- [ ] A production build of the app renders every screen with no visual regression and no CSP
      violation in the console — verified by a full `npm run ui:verify` run in production mode
      (screenshots compared against the current ones, axe report still at zero
      critical/serious/moderate/minor).
- [ ] Any inline style the renderer genuinely needs (a dynamic width, a computed colour) is
      expressed in a way the stricter CSP permits — a CSS custom property set on the element, a
      utility class, or a nonce — and the chosen mechanism is stated once in
      `docs/ARCHITECTURE.md`, so the next dynamic-style case does not reintroduce the token.
- [ ] The dev-mode CSP may keep whatever Vite's HMR needs; the difference between dev and
      production is explicit in the file's comment, not accidental.
- [ ] A regression guard fails if `'unsafe-inline'` reappears in the production `style-src`.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done

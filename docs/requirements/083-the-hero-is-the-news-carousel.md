---
id: 083
title: The hero is the news carousel
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

The top of the home screen becomes the community front page: a rotating hero showing the news the
feed delivered, in the shape the prototype decided — a 320px band spanning the full width next to
the installation rail, above the dashboard. It is the launcher's face, so it must look the same
for everyone: contributors fill fields, they do not design slides.

I must be able to read it at my own speed. It rotates by itself, but stops the moment I hover or
focus it, and there is a pause I can latch. If I have no feed yet, it welcomes me instead of
showing an empty box. If the feed is old because the fetch failed, it says so quietly. A slide's
buttons open in my browser — the launcher never navigates itself somewhere.

See [concepts/home-screen.md](../concepts/home-screen.md) §7 and §11 (variant A is the reference).

## Acceptance Criteria

- [ ] **AC1** — The hero is 320px high, spans the width between the installation rail and the
      window edge, and cannot be moved, resized, hidden or placed by the user.
- [ ] **AC2** — `split`, `banner` and `text` are rendered by launcher-side renderers; a slide's
      frontmatter fills their fields and can contribute no CSS, HTML, colour or layout value.
- [ ] **AC3** — The carousel auto-advances and offers dots, previous, next and an explicit pause
      control.
- [ ] **AC4** — Auto-rotation pauses while the pointer is over the hero or focus is inside it, and
      stays paused after the pause control is used until it is pressed again.
- [ ] **AC5** — With reduced motion, auto-rotation does not run and slide changes do not animate;
      dots, previous and next still work.
- [ ] **AC6** — With no cached feed at all, the hero shows a built-in welcome slide that uses no
      bitmap image and names the first steps; a real feed displaces it.
- [ ] **AC7** — A feed shown after a failed refresh carries an "as of <date>" note and a refresh
      affordance, and no dialog or toast.
- [ ] **AC8** — A slide shows at most three buttons, and pressing one opens the URL through main
      with `shell.openExternal`; the renderer cannot open a URL itself.
- [ ] **AC9** — The carousel is a labelled region, slide changes are announced in a polite live
      region, the slide position is readable as text and not only as a coloured dot, and every
      control is keyboard reachable with a visible focus ring.
- [ ] **AC10** — The hero's filled, welcome and stale states are entries in the `ui:verify` screen
      registry, fed from the fixture without network access, and a full run stays at zero axe
      violations.

## Open Questions

- What is the auto-rotation interval? (Concept open point 3, placeholder 8 s.)
- Where does the manual refresh affordance sit — in the hero, in the titlebar utility row, or
  both? (Concept open point 10.)
- Which hosts does the button allowlist contain? (Concept open point 6 — shared with 082.)

## Plan

_Filled by `/refine 083`._

## Deliverables

_Filled by `/refine 083`._

## Model Hints

_Filled by `/refine 083`._

## Acceptance Tests

_Filled by `/refine 083`._

## Done

_Filled by `/build 083`._

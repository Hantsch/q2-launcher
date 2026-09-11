---
sprint: S19
status: in-progress # planned | in-progress | done
branch: sprint/19
milestone: Phase 4 M1 (install — retail import & demo state)
---

# Sprint S19 — Retail data comes home

## Goal

At the end of this sprint the bootstrap wizard can produce a real, non-demo installation without
the user ever downloading anything they already own: it copies retail data straight out of a
detected Steam/GOG/Epic installation, or out of any folder the user points it at, and an existing
demo installation gets an explicit way out of the demo state instead of being stuck there.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 088 — Retail import from a detected store installation
- [x] 089 — The wizard gains an existing-folder data source
- [ ] 090 — A demo installation upgrades to retail

## Notes

**Scope decision (User, 2026-09-11).** Of Phase 4 M1's remaining work (retail import,
update/rollback, repair, removal from disk), this sprint takes only retail import and the demo
state it closes out — the natural continuation of [[074]]'s free-download-only wizard. Update/
rollback, repair and removal from disk stay out; they do not depend on this sprint's stories and
can be cut and sequenced independently.

**Dependencies.** 089 reuses whatever detection/copy routine 088 implements for its own
folder-inspection step — build 088 first. 090 reuses 088's copy step on an already-registered
installation instead of a fresh one — it needs 088 done, not 089.

**Deliberate omissions.**

- Update, rollback and bleeding-edge tracking (INST-U) — separate slice.
- Repair (INST-R) — depends on the same job machinery but answers a different question
  (`inspectInstallation` findings → fixes) and is not needed to make retail import work.
- Removal from disk (INST-X) — independent, smallest remaining slice, deferred rather than
  padding this sprint.
- Store-edition (2023 re-release) pak compatibility is not verified before this sprint — see
  088's Open Questions; if refine cannot resolve it from documentation alone, the story's own
  fallback (reject with a reason) is the acceptable behaviour for an unrecognised pak size.

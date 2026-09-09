---
sprint: S17
status: in-progress # planned | in-progress | done
branch: sprint/S17
milestone: Install — bootstrap, update and repair (docs/concepts/install-module.md)
---

# Sprint S17 — the bootstrap survives a real, failed run

## Goal

The three gaps a real (non-fixture) bootstrap run exposed on 2026-09-08 are closed: the
allowlist matches the real archives instead of the test fixtures, a failed install stays in
the library instead of vanishing, and the failure card names the actual cause instead of
pointing at a log file.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 076 — The bootstrap assembles the real archives, not the fixtures
- [x] 077 — A failed install stays in my library and shows its last error
- [ ] 078 — The failure says the cause, not "go read the log"

## Notes

All three stories trace back to the same 2026-09-08 real-archive bootstrap run (see
[S16 review](../S16/review.md) follow-ups). 076 fixes the root cause so a real run can succeed
at all; 077 and 078 close the two UX gaps the failure exposed (library state, failure
messaging) independent of that fix. 077 has an open question (cancel vs. failure
distinguishability) to resolve during `/sprint`'s clarification round.

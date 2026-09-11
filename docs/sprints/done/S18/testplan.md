# Sprint S18 — manual test plan

Per `.claude/ai-scrum.md`'s `testplan: optional`: this file lists only the criteria marked
`manual residue` this sprint — everything else was proven by an automated test (see
`review.md`'s Acceptance section). Both residues below belong to story 080.

## 1. R1Q2 actually runs on real Windows (AC4)

**Why it cannot be automated:** the bootstrap wizard's own e2e proof (`bootstrap-r1q2.mjs`) seeds
fixture client files and asserts the assembled target's contents and config — it cannot establish
that the real R1Q2 binary initializes OpenGL, audio and input, or that it can load a map. Fixture
executables are not real, runnable engine binaries.

**Preparation:**
- A Windows machine with a working GPU/driver (no headless CI runner).
- Build and run the packaged app (`npm run build`, then launch it, or run from source with
  `npm run dev`).
- No existing Q2PRO/R1Q2 installation required — this walks a fresh bootstrap.

**Steps:**
1. Open the bootstrap wizard for a new installation.
2. At the engine step, pick **R1Q2**.
3. Complete the wizard (target folder can be any writable path).
4. Wait for the install job to finish.
5. From the library, launch the new installation.
6. Once the game window opens, start a new game / load any map (e.g. the demo map that ships with
   the seeded content).

**Expected result:** the engine window opens without a graphics/driver error, audio is audible,
mouse look and keyboard movement respond, and the chosen map loads and renders (not a black
screen or an immediate crash to desktop).

## 2. R1Q2's bundled dependency notices are legally complete (AC8)

**Why it cannot be automated:** this is a legal/maintainer judgment call, not a testable
behaviour. The launcher is proven to install the GPLv3 license text and to surface engine
source/license info (automated, see story 080's Done section) — whether the *set* of
dependency/third-party notices is exhaustive is outside what a test can assert.

**Preparation:** the community `engines/r1q2/README.md` (in the content repository) already lists
its own remaining dependency-notice work — read that first.

**Steps:**
1. Review R1Q2's upstream project for any third-party/dependency license notices beyond the
   GPLv3 text itself (bundled libraries, forked code, etc.).
2. Compare against what `resources/licenses/r1q2/` currently ships.

**Expected result:** either confirm the current bundle is complete, or file a follow-up story to
add the missing notices before R1Q2 is offered in a public release.

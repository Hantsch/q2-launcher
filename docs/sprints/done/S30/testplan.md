# Sprint S30 — Testplan (manual residue only)

Only what cannot be automated. Everything else is covered by the tests listed in `review.md`.

## 1. Story 183 — judge the latency screenshots by eye (AC4)

**Why manual:** whether console and notify lines are visible and readable on screen is a human judgment.

**Preparation:** open `spikes/183-control-latency/results/` (the JSON + PNG pairs); `combo-4` and the
baseline config are the pair that matters.

**Steps:**

1. Open the `combo-4` PNG and the baseline PNG side by side.
2. Look at the game console / notify area in each.

**Expected:** with `combo-4` the console and notify lines stay as readable as in the baseline (no flood, no
scrolling over the demo); otherwise note it as a finding against 185's `logfile_flush 3`.

## 2. Story 183 AC6 / 185 — Linux control latency

**Why manual:** there is no Linux Q2PRO on the development machine, so stdout buffering of the Linux channel
was never measured.

**Preparation:** a Linux machine with a Q2PRO build and the launcher; a demo to play.

**Steps:**

1. Play a demo in the launcher, click pause/resume and jump 10 s three times quickly.
2. Time from click to the game reacting (frame-stepped screen recording, or the spike harness adapted to
   `linux-channel.ts`).

**Expected:** control-to-effect is well under the pre-S30 ~1.5 s buffered delay; if not, open a story for a
Linux lever (none was applied in 185).

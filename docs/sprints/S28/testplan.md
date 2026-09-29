# S28 — manual residue

Needs a real Q2PRO installation, the licensed Quake II data and a GPU; the stub engine cannot fake any of it.

1. **Latency (164).** Play a demo and drag the seek bar / press jumps repeatedly for a minute. Expected: send→ACK p95 (debug log) ≤ 300 ms.
2. **CPU (164).** Compare Q2PRO's CPU with a demo playing (loop on) vs finished (loop off). Expected: difference ≤ 5 %.
3. **Map change (164).** Play a multi-map demo across a map change. Expected: position events keep flowing and seek still works.
4. **Bound key (167).** Bind a speed-up and a jump key in a Q2PRO profile, launch, play a demo, press them. Expected: speed moves one step per press; the jump moves the configured seconds.

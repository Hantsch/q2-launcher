# Engine test demos

Real demos recorded with native Q2PRO on the shareware data, so engine tests play back a genuine
recording rather than one synthesized by a writer under test.

| File                   | What it is                                                    |
| ---------------------- | ------------------------------------------------------------- |
| `move-fire.dm2`        | The recording, as Q2PRO wrote it.                             |
| `move-fire.dm2.gz`     | The same bytes, `gzip -9 -n`; gunzips to `move-fire.dm2`.     |
| `record-move-fire.cfg` | The script that drove the recording.                          |
| `test-demos.test.ts`   | Reads every demo's header and checks the length (`npm test`). |

`pause-section.dm2` is not recorded yet.

## move-fire.dm2

- Map `demo1` ("Outer Base"), game dir `baseq2`, protocol 34 (Q2PRO's default `record`, no `-e`).
  The shareware `pak0.pak` ships the first unit as `demo1`–`demo3`; there is no `base1` in it.
- Length: 295 demo frames at 10 Hz = 29.5 s.
- Fire (`+attack`) windows, in demo frames, each approximate ±2 frames:
  - 50–70 (standing, after walking forward)
  - 85–110 (walking forward)
  - 130–145 (after turning left)
  - 175–195 (turning right)
- Between them the player walks (`+forward`) and turns (`+left`, `+right`); the last ~10 s are idle.

## Data

The game data is the shareware `pak0.pak` that `npm run engine:data` puts into the local cache
(`%LOCALAPPDATA%\q2l-engine-test\baseq2\pak0.pak`). No game data is committed; only the recorded
demo is. Only the game library came from the native Q2PRO install (`libdir`), never its paks.

## How it was recorded

Q2PRO r3834~601a8df8 (Windows x86_64). `record-move-fire.cfg` was copied into a scratch home dir
`<tmp>\home\baseq2\` (so `exec` finds it and no retail `autoexec.cfg`/config is read), then:

```sh
q2pro.exe +set basedir C:/Users/<you>/AppData/Local/q2l-engine-test \
  +set homedir <tmp>/home +set libdir C:/Games/Q2Pro +set game "" \
  +set logfile_flush 1 +set logfile_prefix "[%H:%M:%S] " +set logfile 1 \
  +path +map demo1 +exec record-move-fire.cfg
```

The cfg pins `cl_async 0` / `cl_maxfps 60`, so its `wait N` counts are wall-clock time, waits for
the level, records, then `stop` and `quit` — Q2PRO ends itself, which also flushes its buffered
log. Synthetic keystrokes never reach Q2PRO, so all input is scripted in the cfg. Q2PRO wrote the
demo to `<tmp>\home\baseq2\demos\move-fire.dm2`; it was copied here unchanged.

## Manual check

Watch it once in native Q2PRO with the same data: copy `move-fire.dm2` into
`<tmp>\home\baseq2\demos\`, start Q2PRO with the `basedir`/`homedir`/`libdir` above and run
`demo move-fire`. Expect walking, turning and blaster fire in the windows above.

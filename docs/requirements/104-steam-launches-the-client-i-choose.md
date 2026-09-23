---
id: 104
title: steam launches the client i choose
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-23
---

## Requirement

Split out of [story 103](103-a-windows-build-runs-on-linux-through-a-runner-i-choose.md) on
2026-09-23: 103 covers the local runners (native / wine / umu-run) and the refusal gate, this story
covers the one runner that is not a wrapper but a handoff — Steam.

A user whose Quake II came from Steam already has a working way to run it: Steam itself, with
whatever Proton the user configured. The launcher should offer that as a runner alongside the local
ones, which means knowing the installation's appid and which of the app's clients to start.

The Steam app is not one game: appid 2320 ships the 2023 remaster *and* the original, and Steam
selects between them by launch-option index in the URL.

| URL | Runs |
| --- | --- |
| `steam://launch/2320/client/1` | Enhanced Quake II (the 2023 remaster) |
| `steam://launch/2320/client/2` | Quake II (Original) |
| `steam://launch/2320/client/3` | The Reckoning (Original) |
| `steam://launch/2320/client/4` | Ground Zero (Original) |

Invoked as `steam 'steam://launch/2320/client/2'`, verified working on the beta tester's machine
(2026-09-22).

Two consequences the design has to carry rather than paper over:

- **The appid is not known today.** Detection finds that folder by *name*
  (`steamapps/common/Quake 2`, `src/main/services/detection/providers.ts:77`), so nothing in the
  launcher knows it is 2320. `steamapps/appmanifest_<appid>.acf` sits one level above `common/` and
  carries `"appid"` and `"installdir"` — the same naive `"key" "value"` scraping
  `steamLibraryRoots()` already does on `libraryfolders.vdf` reads it. Hardcoding 2320 is not
  acceptable: the mission packs and the GOG and remaster entries have their own ids, and a
  folder-name match cannot tell them apart.
- **A `steam://` URL takes no arguments.** Handing off to Steam discards the whole launch plan —
  the generated `+set` arguments, the user's `launchArgs` and `activeGameDir` — and `steam` returns
  immediately, so there is no child process to observe. Note that `/client/3` and `/client/4` are
  Steam's own way of doing what `+set game xatrix|rogue` does, so the client choice partly
  *replaces* the launcher's game-dir selection instead of coexisting with it.

Depends on 103: the runner choice, the runner picker UI and the disabled-with-visible-reason
pattern all come from there. This story adds one more runner kind to an existing mechanism.

## Acceptance Criteria

- [ ] **AC1** — A Steam-owned installation knows its Steam appid, read from the
      `appmanifest_<appid>.acf` whose `installdir` matches the folder detection found. An
      installation whose appid cannot be established is not offered the Steam runner at all — no
      id is ever guessed or hardcoded.

- [ ] **AC2** — For a Steam-owned installation the user chooses **which client** Steam should
      launch, from the app's own launch options (for 2320: Enhanced Quake II, Quake II Original,
      The Reckoning, Ground Zero), and the launcher hands off with the corresponding
      `steam://launch/<appid>/client/<n>` URL. The client names come from the launcher's i18n
      catalogue; the appid/index pairing is data, not code.

- [ ] **AC3** — The Steam handoff states what it gives up, as visible text at the point of choosing
      it — not in a changelog: the launcher's own launch arguments and active game directory are not
      applied, and there is no process to observe, so no playtime is recorded. `launch:state` never
      claims a `running` game it cannot see; the handoff has its own honest terminal state.

- [ ] **AC4** — The Steam runner is offered only for `isStoreManaged()` sources. On a machine
      without Steam, or for a folder Steam does not own, it is shown disabled with its reason as
      visible text, exactly like 103's other unavailable runners.

## Open Questions

**Q1 — Where do the client entries come from?** The four indices for 2320 are known from the
tester, but they are a property of *that app's* launch configuration, and nothing in the launcher
can enumerate an app's launch options — Steam does not expose them in a file we parse today.
Proposal: a small shipped table keyed by appid (2320 → four named clients), with the honest
fallback that an unknown appid gets a plain `steam://launch/<appid>` and no client choice. Needs a
decision: a shipped table means a new appid is a code change, which the `ENGINE_DEFINITIONS`
precedent says is acceptable if it is *data*.

**Q2 — What is `launch:state` for a handoff?** Three shapes: (a) a new terminal phase
(`handed-off`) that never claims `running`; (b) reuse `exited` immediately, which is a lie of a
different kind; (c) poll for the game process by name, which is fragile and would be the launcher's
first piece of process-table guessing. AC3 requires (a) or something equally honest; refine picks
the shape and the write-guard consequence (a handed-off game is *not* under the guard, so a job
could copy into a folder a Steam-run game has open — worth an explicit decision, not an oversight).

**Q3 — How is a handoff proven end to end?** Neither Steam nor a real Proton prefix exists on CI.
The `steam` invocation itself can be stubbed the same way 103 stubs `wine` (a script on `PATH`),
which proves the URL the launcher builds and the terminal state it reports — but not that Steam
then starts the right game. Needs a decision on where the automated line is drawn and what, if
anything, stays `manual residue`.

## Plan

<!-- Filled by /refine 104. -->

## Deliverables

<!-- Filled by /refine 104. -->

## Model Hints

<!-- Filled by /refine 104. -->

## Acceptance Tests

<!-- Filled by /refine 104. -->

## Done

<!-- Filled by /build 104. -->

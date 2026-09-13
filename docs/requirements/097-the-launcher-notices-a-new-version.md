---
id: 097
title: The launcher notices a new version
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-13
---

## Requirement

Once [[096]] publishes releases, a user who installed the launcher once has no way of learning
that a newer one exists — beta users are exactly the people who will not watch a releases page.
The launcher has to find out for them: once a day, at startup, quietly, and then hold that
knowledge until the user decides what to do with it ([[098]]).

Quietly is the requirement, not a nicety. A check that fails — no network, GitHub down, a rate
limit — must cost the user nothing: no dialog, no toast, no delayed startup, no repeated retry
storm. The launcher is a game launcher; if it cannot reach the update feed it starts and launches
games exactly as before. Equally, a check must not run more than once a day just because the user
restarts the launcher six times in an evening, and must not run at all in development, where the
version is whatever the working tree says.

This story is the knowledge, not the act: it decides _whether_ an update exists, what version it
is and what its notes say, and exposes that state over the IPC contract. Downloading, installing
and restarting belong to [[098]]; showing the notes in About belongs to [[099]].

## Acceptance Criteria

- [ ] **AC1** — On startup, the launcher checks for a newer published release at most once per
      24 hours; further starts within that window reuse the last result instead of checking again.
- [ ] **AC2** — When the published release is newer than the running version, the launcher holds
      an "update available" state carrying that version and its release notes; when it is not, the
      state says up to date.
- [ ] **AC3** — A failed check (offline, error response, malformed feed) leaves a state carrying
      the reason, shows the user nothing by itself, and does not delay or block startup.
- [ ] **AC4** — A failed check does not burn the daily window: the next start may check again
      rather than waiting 24 hours on a result that never arrived.
- [ ] **AC5** — No check runs in development or in an unpackaged build.
- [ ] **AC6** — The renderer can read the current update state and be told when it changes,
      through the typed IPC contract — no direct network access and no version comparison in the
      renderer.
- [ ] **AC7** — The user can trigger a check by hand at any time, independently of the daily
      window, and sees its outcome (including a failure reason).
- [ ] **AC8** — The check result survives a restart, so the launcher does not forget between
      sessions what it already knows.

## Open Questions

- **`electron-updater` or a hand-rolled check?** The project ships NSIS + zip, so
  `electron-updater`'s GitHub provider reads the `latest.yml` [[096]] publishes and gives
  download + install for [[098]] for free, at the price of a new runtime dependency and its own
  update semantics. `claude-control` hand-rolled its updater (`src/main/selfUpdate.ts`) only
  because it ships a portable EXE, which `electron-updater` cannot install — that reason does not
  apply here. Recommendation: `electron-updater` with `autoDownload: false`; confirm.
- Depends on [[096]]'s open question about repository visibility and the prerelease channel: if
  beta releases are marked prerelease, this story has to decide whether they count as "newer".

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

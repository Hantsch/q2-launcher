---
id: 071
title: A download is a verified job, never a trusted file
status: draft
created: 2026-09-08
---

## Requirement

Downloading a package from the manifest ([[070]]) has to produce a file the launcher can trust
enough to extract and run — this is foreign, executable content pulled from the internet. This
story builds the `downloads` module's core pipeline: turn a manifest package into a running
`Job` (the shell's existing, unused job pipeline), verify it against the manifest's size and
SHA256 with mirror fallback on mismatch, and extract it with the bundled 7-Zip binary. Nothing
in this story is user-reachable yet — [[074]] wires it to the wizard — but it is fully testable
against a manifest fixture and a local test server.

## Acceptance Criteria

- [ ] **AC1** — Downloading a package produces a `Job` through the existing `JobsService`; no
      parallel progress mechanism is introduced.
- [ ] **AC2** — At most as many jobs run at once as the concurrency limit allows ([[072]] adds
      the setting; this story reads it); further jobs queue.
- [ ] **AC3** — Every downloaded file is checked against the manifest's declared size and SHA256
      before it is used for anything.
- [ ] **AC4** — On a hash or size mismatch, the file is deleted, the next mirror in the
      manifest's list is tried, and if every mirror fails, the job fails with a readable, i18n'd
      reason. There is no override.
- [ ] **AC5** — Extraction runs only on a verified file, via the bundled 7-Zip binary invoked
      with a fixed absolute path and a fixed argument shape assembled from validated values —
      never a renderer-supplied argument.
- [ ] **AC6** — Cancelling a job removes any partial download and any partially extracted
      output.
- [ ] **AC7** — All network access, hashing, and extraction happen in main; the CSP
      (`connect-src 'self'`) is unchanged.

## Open Questions

- Which 7-Zip variant ships (`7zr.exe`, `7za.exe`, full `7z.exe`) — this decides licensing
  obligations for our own distribution and how electron-builder packages/resolves it in dev vs.
  production. (concept open point 8)
- Per-request timeout, retry budget before falling to the next mirror, and whether the system
  proxy is honoured. (concept open point 10)
- Pause/resume across an app restart (HTTP range requests resuming from a recorded byte offset)
  is real concept scope but deliberately **not** built in this story — is an in-session
  pause/cancel enough for this sprint's playable increment, with cross-restart resume as a
  fast-follow, or does the wizard's first playable moment require restart-safe resume from day
  one?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

---
id: 111
title: master sources are a list i edit
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the `servers` module's ([[106]]) settings section and finds the list of master
sources a scan will query — not fixed to one website, but a list they can add to, remove from,
reorder, and switch on or off entry by entry (GB-S1). The launcher ships with a sensible default
list so a fresh install already works, but nothing about the source list is hard-coded once the
user wants to change it — "falls ein master stirbt", per the concept's own rationale (§3).

Each source has a type — a UDP master (`udp-master`) or an HTTP list (`http-list`) — and an
address; [[109]]'s codecs are what actually speaks either protocol during a scan, this story only
stores and validates the configuration they will later be pointed at (GB-S2). The list persists in
the module-owned state key [[110]] built.

Shipped defaults, per the concept (§6.5/§7.1): the UDP masters `master.q2servers.com` and
`master.quakeservers.net`, and the HTTP list `q2servers.com` with `?raw=1`.

Renderer-supplied source entries are never trusted as-is (CLAUDE.md's standing rule): every add or
edit is validated against a zod schema before it reaches main, the same discipline every other
renderer-facing IPC payload in this repo already carries.

## Acceptance Criteria

- [ ] **AC1** — A fresh install's source list contains exactly the three shipped defaults —
      `master.q2servers.com` and `master.quakeservers.net` as `udp-master`, `q2servers.com?raw=1`
      as `http-list` — each correctly typed.
- [ ] **AC2** — The settings section lets a user add a new source (type + address), remove an
      existing one, reorder the list, and toggle a source enabled/disabled, each action persisting
      immediately through [[110]]'s state key.
- [ ] **AC3** — Each source's type (`udp-master` / `http-list`) and address round-trip through a
      restart unchanged — persistence does not collapse or default either field.
- [ ] **AC4** — Every source entry submitted from the renderer (add or edit) is validated by a zod
      payload schema in main before it is written to state; a malformed entry (unknown type,
      empty/invalid address) is refused with a reason, never silently dropped or silently accepted.
- [ ] **AC5** — Disabling a source keeps it in the list (address and type intact) rather than
      removing it — re-enabling it requires no re-entry.

## Open Questions

- [ ] **Q1 — Master rate-limit etiquette (concept open point #15).** The concept raises whether the
      launcher should also bound how often it re-fetches a given master source, distinct from how
      often it queries individual game servers. This story's scope is the source list's CRUD and
      shape, not scan timing — bounding re-fetch cadence belongs with the scan engine and its
      settings (sprint 9.3, [[114]]/[[115]]), where the other scan-budget settings (concurrency,
      timeout, minimum spacing between automatic scans) are already being defined. Deferred there,
      not decided here.

## Plan

<!-- Filled by `/refine 111`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 111`. -->

## Model Hints

<!-- Filled by `/refine 111`. -->

## Acceptance Tests

<!-- Filled by `/refine 111`. -->

## Done

<!-- Filled by `/build 111`. -->

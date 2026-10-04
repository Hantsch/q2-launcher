---
id: 240
title: the install folder is created for me and shown before I install
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a new user installing Quake II, I pick _where_ it goes and the launcher creates the installation's
own folder there, showing me the exact final path before anything is written — I never have to know
that I should create an empty folder first.

User feedback 2026-10-04: when choosing a folder you only choose where it installs to; the folder
should be created and shown — users do not realise they must create a folder.

Today the picker (`showOpenDialog`, `openDirectory` + `createDirectory`, the latter macOS-only)
returns a folder and the wizard installs **directly into it**. Users pick `D:\Games`, get a
"folder not empty" warning they do not understand, or end up with Quake II files spread over
`D:\Games`.

Concept: [install-module.md](../systems/install-module.md).

## Acceptance Criteria

- [ ] **AC1** — The target step asks for a parent location and proposes a new subfolder in it,
      named after the installation (e.g. `D:\Games\Quake II`), which the user can edit.
- [ ] **AC2** — The full final path is shown as text in the target step and again on the confirm
      step, before anything is written.
- [ ] **AC3** — The launcher creates the folder when the install starts; the user never has to create
      it in the file dialog.
- [ ] **AC4** — If the proposed subfolder already exists and is not empty, the launcher proposes a
      free name (`Quake II (2)`) instead of warning about a non-empty target.
- [ ] **AC5** — Choosing a folder that is already an empty folder still works: the user can say
      "install right here" and the subfolder is not added.
- [ ] **AC6** — Unsafe or blocked targets (Program Files, not writable, already an installation) are
      still judged — on the final path, not the parent.
- [ ] **AC7** — A cancelled or failed install removes the folder the launcher created, if it is
      still empty.

## Open Questions

- **Q1** — Default subfolder name: the installation's name, or a fixed `Quake2`? Recommendation:
  the installation name, sanitised for the file system (depends on [[239]]'s name field).
- **Q2** — Is "install right here" (AC5) automatic when the chosen folder is empty, or an explicit
  option? Recommendation: automatic for an empty folder, with the shown path making it obvious.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done

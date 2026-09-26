---
id: 107
title: a server address is validated before it is trusted
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Before any server address — whether it came from a master source, an HTTP list, or something the
user typed by hand — is allowed to influence what the launcher launches or stores, it has to be
proven to actually be an address: a host or IPv4 literal plus a port, and nothing else riding along
with it.

The concept is explicit about why this cannot be an afterthought (§10.1): r1q2's `+connect` argument
is handled by a *late* command parser that is re-tokenized normally — unlike `+set`, it honours
quotes and spaces. An address string that reaches `buildLaunchArgs` unvalidated is not just a wrong
hostname risk, it is a way for foreign data (a master's reply, a pasted string) to inject additional
tokens into the argument vector the launcher hands to the game. This is CLAUDE.md's "paths from the
renderer are never trusted" rule applied to a different kind of untrusted value.

This story delivers one thing: a pure, reusable address validator with no IO. It has no UI and no
IPC channel of its own — it exists so three later stories can each call the same strict check
instead of writing three slightly different ones: the join flow (GB-J2), manual server entry
(GB-S4), and the address-book write. [[107]] is referenced by name from each of those when they are
written, so this story's Requirement is written to stand on its own, ahead of any of them existing
yet.

The concept records IPv6 as an open point (#9): the classic UDP master record format is IPv4-only,
and whether a manually entered server may be IPv6 was never decided. This story recommends a
decision rather than silently picking one: **validate IPv4 literals and hostnames only for v1**,
matching what a master can actually return and what `+connect` has ever needed to carry in this
ecosystem; IPv6 is deferred as a genuinely open question below rather than folded into either
answer without discussion.

## Acceptance Criteria

- [x] **AC1** — A pure function accepts a `host:port` or IPv4-literal `a.b.c.d:port` string and
      returns a typed success result with the parsed host and port when the input is well-formed.
- [x] **AC2** — The same function rejects, with a distinct reason per case, at minimum: extra
      whitespace-separated tokens after the address, shell/argument metacharacters (quotes,
      backslashes, semicolons, `+`-prefixed tokens), a missing port, a non-numeric port, and a port
      outside 1–65535.
- [x] **AC3** — A hostname component is validated against a defined, documented character set (no
      spaces, no control characters, no bytes above 126 — consistent with `buildLaunchArgs`'s existing
      finding in `docs/ARCHITECTURE.md` that r1q2 treats any byte above 126 as a separator); anything
      outside it is rejected rather than silently truncated.
- [x] **AC4** — The validator is a standalone module with no `node:*`, `electron`, or IPC import —
      callable from a unit test with no process boundary crossed — and ships with unit tests covering
      every accept/reject case in AC1–AC3.
- [x] **AC5** — The validator's rejection result carries a reason distinguishable per failure class
      (not a single generic "invalid address" string), so a future caller (join warning, manual-entry
      form error, address-book dialog) can show a specific i18n-keyed message rather than one catch-all.

## Open Questions

- [x] ~~**Q1 — Is IPv6 in scope for the address validator, or explicitly out for v1?** The concept
      leaves this unresolved (open point #9). Recommendation: IPv4 literals and hostnames only for
      this story and for everything that consumes it in this milestone (join, manual entry,
      address-book write); an IPv6 literal is rejected the same as any other malformed input, not
      silently accepted or silently mistaken for a hostname. Confirm before `/refine`, since it
      changes AC2's rejection list either way.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** IPv6 scope for the address validator: out of scope for v1. IPv4 literals and
  hostnames only, for this story and every consumer of it in this milestone (join, manual entry,
  address-book write); an IPv6 literal is rejected the same as any other malformed input.
- **Home is `src/shared/servers/address.ts` (+ `address.test.ts`), not `src/shared/modules/servers.ts`** —
  `src/shared/modules/*.ts` is the module's IPC contract ([[106]] owns that file), while pure
  cross-process logic lives in its own shared folder, exactly as `src/shared/config/*` does for the
  config module.
- **The API is one strict parse function returning a discriminated union** —
  `parseServerAddress(input)` yields `{ ok: true, host, port, kind: 'ipv4' | 'hostname', normalized }`
  or `{ ok: false, reason }` — because a boolean plus a thrown error would force every one of the
  three later callers to re-derive the parsed host/port they all need anyway.
- **Rejection carries a reason *code* (a string-literal union) plus an i18n key, never prose** —
  the same rule `src/shared/config/validation.ts`'s `Finding.messageKey` already follows, so a
  caller in the renderer resolves the text and the main process never ships English across IPC.
- **Thirteen distinct reason codes** (`empty`, `extra-tokens`, `forbidden-character`,
  `argument-token`, `missing-port`, `port-not-numeric`, `port-out-of-range`, `too-many-colons`,
  `ipv6-not-supported`, `host-empty`, `host-too-long`, `host-label-invalid`,
  `ipv4-octet-out-of-range`) — AC5 asks for a reason per failure *class*, and these are exactly the
  classes AC2/AC3 name, each mapping to one message a user could act on.
- **An IPv6 literal gets its own `ipv6-not-supported` code** — it is still rejected, exactly as the
  (User) decision above requires; a dedicated code only decides *which sentence* the rejection
  shows and does not reopen the scope question.
- **Host character set: lowercase `[a-z0-9-]` labels, 1–63 characters each, no leading or trailing
  hyphen, 253 characters total, no underscore** — the classic hostname rule, and it is strictly
  inside the "no byte above 126, no control character, no space" floor `docs/ARCHITECTURE.md`
  derives from r1q2's tokenizer, so nothing this validator accepts can be re-split by the engine.
- **A dotted all-numeric candidate is judged as IPv4, never as a hostname** — `1.2.3.300` is
  rejected as `ipv4-octet-out-of-range` instead of falling through to the hostname branch, where an
  all-numeric TLD would be invalid anyway; a leading zero in an octet is rejected too, because
  `010` is octal to some resolvers and would resolve differently from what the user read.
- **Outer whitespace is trimmed, inner whitespace is a rejection** — a pasted address routinely
  carries a trailing newline, whereas whitespace *inside* the string is precisely the `+connect`
  token-injection vector §10.1 warns about.
- **The normalized form is lowercase host + `:` + decimal port** — favourites, history and manual
  servers are all keyed by address (concept §11), so one canonical spelling has to exist before the
  first of those stores does.
- **No default-port fill** — AC2 makes a missing port a rejection, so a consumer that wants
  `:27910` appended does that before calling and the validator stays one rule with one answer.
- **A zod primitive `serverAddressSchema` ships in `src/shared/schemas.ts` (D2)** — CLAUDE.md's
  contract-first rule means every later `module:servers` handler needs a zod payload schema, and
  `schemas.ts` is the documented home for shared primitives; without it the three named consumers
  would each write their own refinement, which is the duplication this story exists to prevent.
- **`buildLaunchArgs` / `LaunchInput.connect` is not touched here** — the join flow (GB-J2) owns
  that call site, and wiring it now would add launch-path regression risk to a story whose criteria
  are entirely about the pure function.
- **No e2e flow** — every criterion describes pure core behaviour with no user action and no
  surface, so `ui-acceptance-required` does not bite and the unit suite is the acceptance gate.
- **No platform delta to declare** — a string parser behaves identically on Windows and Linux, so
  there is no control to disable and no "Not available on …" text to write.

## Plan

1. **D1 — the validator.** New pure module `src/shared/servers/address.ts`: the
   `ServerAddressRejection` reason-code union, the `ParsedServerAddress` / `ServerAddressResult`
   types, `parseServerAddress()`, `formatServerAddress(host, port)` and
   `serverAddressRejectionKey(reason)`. Order inside the parser: trim → empty → forbidden
   character (control byte, byte above 126, quote, backslash, semicolon) → `+`-prefixed token →
   inner whitespace → bracket/colon analysis (IPv6, too many colons) → split host/port → port
   checks → IPv4-quad branch or hostname-label branch. Mirror the file-doc style and reason
   discipline of `src/shared/config/alias-names.ts` and `src/shared/config/validation.ts`.
2. **D1's test** `src/shared/servers/address.test.ts`: a table-driven accept set and a reject set
   with one case per reason code, plus the purity assertion (the module's own source contains no
   `node:`, `electron` or IPC import).
3. **D2 — the zod seam.** `serverAddressSchema` in `src/shared/schemas.ts`, a
   `z.string().superRefine(...)` built on `parseServerAddress` so a rejection's reason code becomes
   the issue message; tested in the same test file. This story adds no IPC channel, so
   `src/shared/ipc.ts` stays untouched.
4. **D3 — the messages.** `servers.address.reject.<reason>` entries in
   `src/renderer/src/i18n/locales/en.json`, plus a test that every reason code has a key, so the
   three later callers find the vocabulary already there instead of inventing three variants.

Affected files: `src/shared/servers/address.ts` (new), `src/shared/servers/address.test.ts` (new),
`src/shared/schemas.ts`, `src/renderer/src/i18n/locales/en.json`. No main, preload or renderer
component code, no IPC channel, no shell edit.

## Deliverables

- [x] **D1 — the pure address validator, with its unit tests.**
  Files: `src/shared/servers/address.ts` (new), `src/shared/servers/address.test.ts` (new).
  Mirror: `src/shared/config/alias-names.ts` (pure shared validator with a documented character
  rule) and `src/shared/config/validation.ts` (i18n-key-not-prose result shape).
  Acceptance: `parseServerAddress` accepts `host:port` and `a.b.c.d:port` and returns host, port,
  `kind` and `normalized`; it rejects with the correct one of the thirteen reason codes for every
  class in AC2/AC3; the test file carries at least one accept case per `kind`, one reject case per
  reason code, and an assertion that the module's source imports nothing from `node:*`, `electron`
  or the IPC layer.
- [x] **D2 — the zod primitive later `servers` handlers validate with.**
  Files: `src/shared/schemas.ts`, `src/shared/servers/address.test.ts` (extend).
  Mirror: `absolutePathSchema` in the same file.
  Acceptance: `serverAddressSchema` parses a valid address into its normalized string and fails a
  malformed one with the reason code as the issue message; no other schema in the file changes.
- [x] **D3 — every rejection has a message key.**
  Files: `src/renderer/src/i18n/locales/en.json`, `src/shared/servers/address.test.ts` (extend).
  Mirror: `src/shared/config/comment-labels.test.ts` (a shared test that reads `en.json`).
  Acceptance: every `ServerAddressRejection` code resolves through `serverAddressRejectionKey()` to
  a key present in `en.json`, proven by a test iterating the union; no existing key is renamed.

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- Review: → default — one new pure file plus two additive edits, no existing behaviour changed and
  no process boundary involved, so there is nothing here for a review to regress against.

## Acceptance Tests

- AC1 → D1, unit `src/shared/servers/address.test.ts` › "accepts a hostname and an IPv4 literal with
  a port"
- AC2 → D1, unit `src/shared/servers/address.test.ts` › "rejects each malformed address with its own
  reason"
- AC3 → D1, unit `src/shared/servers/address.test.ts` › "rejects a host outside the documented
  character set"
- AC4 → D1, unit `src/shared/servers/address.test.ts` › "imports nothing from node, electron or the
  IPC layer"
- AC5 → D1 + D3, unit `src/shared/servers/address.test.ts` › "every rejection reason has its own
  i18n key"

No criterion in this story describes a user action — the story has no surface and no IPC channel of
its own — so nothing maps to the `e2e` gate and there is no manual residue.

## Done

**Summary.** Delivered the pure `parseServerAddress` validator (`src/shared/servers/address.ts`)
with its 13-reason-code discriminated-union result, `formatServerAddress` and
`serverAddressRejectionKey`; a `serverAddressSchema` zod primitive in `src/shared/schemas.ts` built
on the same parser; and an i18n key per rejection reason under a new `servers.address.reject.*`
section in `en.json`. No IPC channel, no UI, no `buildLaunchArgs` change, exactly as planned.

**Commit message:**
```
107: validate a server address before it is trusted
```

**Verification — narrow gate.**
- `npm run build` — green.
- `npm run typecheck` — green after one incidental fix: `address.test.ts`'s purity check reads
  `address.ts`'s own source via `node:fs`/`node:path`/`node:url`, which the renderer's
  `tsconfig.web.json` (no `node` types) rejected. Excluded that one file from `tsconfig.web.json`
  and left it covered by `tsconfig.node.json`'s existing `src/shared/**/*.ts` include — the same
  pattern already used there for `shell-home-ownership.test.ts` (see that file's own comment).
- `test-story` (`npx vitest run --changed HEAD`) — 1547/1548 passed, one flake:
  `src/renderer/src/modules/servers/ServersSettingsSection.test.tsx` timed out (5000ms) only inside
  the full parallel `--changed` run (also saw one-off `EBUSY`/timeout flakes in
  `profiles.test.ts` and `AppShell.test.tsx` on the first pass, gone on a second run). Checked per
  the workflow's stash rule: ran the same file in isolation with the story's changes present (green,
  4.4s) and again on bare `HEAD` via `git stash push -u` (green, 4.75s). Confirmed pre-existing
  machine/parallel-run contention, not caused by this story — none of its own logic touches that
  test's import path.
- Story's own tests in isolation: `npx vitest run src/shared/servers/address.test.ts
  src/shared/config/comment-labels.test.ts` — 121/121 passed.
- e2e-story: skipped, as planned — the story has no user-facing surface (see Decisions: "No e2e
  flow"); confirmed still true, nothing in D1–D3 added a route, IPC channel or UI component.
- Code review (clean agent, default tier): **PASS**, no findings. AC1–AC5 each verified against
  their named test with file:line evidence; every named test judged non-tautological (exact-shape
  `toEqual`/hand-traced assertions, not implementation restatement); no weakened tests, no scope
  creep, `src/shared/ipc.ts` confirmed untouched, full parse order and character-set rules traced
  against the Plan and found correct. One cosmetic-only nit noted (not a finding): the zod
  `.transform()` re-invokes `parseServerAddress` on top of `superRefine`'s call — harmless (pure,
  no IO) and not fixed.

**AC → test mapping, as verified:**
- AC1 → `address.test.ts` › "accepts a hostname and an IPv4 literal with a port" — passed.
- AC2 → `address.test.ts` › "rejects each malformed address with its own reason" — passed.
- AC3 → `address.test.ts` › "rejects a host outside the documented character set" — passed.
- AC4 → `address.test.ts` › `describe('purity', ...)` "imports nothing from node, electron or the
  IPC layer" — passed.
- AC5 → `address.test.ts` › "every rejection reason has its own i18n key" (D1+D3) — passed.
- No manual residue — the story declares none, and nothing found during build needed one.

**Decisions made during build (beyond the story's own Decisions section):**
- `tsconfig.web.json` gained a narrow, documented `exclude` for `src/shared/servers/address.test.ts`
  so its node-only purity self-check can typecheck under `tsconfig.node.json` instead — mirrors the
  existing `shell-home-ownership.test.ts` precedent in the same file.
- The IPv6-vs-`too-many-colons` boundary (left as an implementation judgment call by the Plan): a
  candidate with a bracket, a `::`, or ≥3 colons where every segment looks like a 1–4-digit hex
  group is `ipv6-not-supported`; any other multi-colon string is `too-many-colons`. Documented in
  `address.ts`'s file header.
- `1.2.3` (a 3-label all-numeric host, not a 4-label IPv4 candidate) falls through to the hostname
  branch and is rejected as `host-label-invalid` (all-digit labels are invalid hostname labels) —
  documented in the same file header, matching the story's own reasoning for why an all-numeric
  candidate is never mistaken for a hostname.

No open points or blockers. `status` set to `done` below.

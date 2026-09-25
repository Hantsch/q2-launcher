---
id: 128
title: an unlock code proves what it unlocks
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

The watchlist ([[131]], [[132]]) ships hidden — the concept is explicit that it "ships behind a
signed unlock code" (`docs/concepts/game-browser.md` TL;DR, §13). This story is not really about
the game browser at all: it is the launcher-wide mechanism that makes an unfinished feature
non-discoverable until someone hands the user a code naming it, with the watchlist as its first
and, for now, only consumer (§13, opening line). [[129]] builds the Settings surface on top of
whatever this story exposes; [[130]] builds the "does not render, is not registered" enforcement
on top of whatever this story decides is valid.

The mechanism is a compact **signed token** (§13.2): Ed25519 via `node:crypto`, a public key
embedded in the app, verified **in main only** — the renderer never sees the private key and never
makes the accept/reject call itself. This is deliberately not a licence check (§13.5, "gatekeeping,
not security") — the app runs on the user's own machine, and someone determined can always patch
around it. What it has to resist is casual guessing, not a determined attacker: a real signature is
what turns "the maintainer decided to unlock this" into a fact main can check offline, with no
server round-trip.

The token's payload carries: the **feature names** it unlocks (so one code can unlock `watchlist`
and nothing else, or several features at once), the **installation id** it was issued for (device
binding, §13.3 — the answer to "can a code be forwarded" when there is no server to record a
redemption), an **issued-at** and a **redeem-by** timestamp (the activation window), an optional
**feature expiry**, and an optional **label** for the user's own benefit.

**Redemption window and feature expiry are two different clocks, and conflating them would be a
bug.** The window only gates *activation* — once a code has been redeemed inside it, the window
stops mattering entirely and the unlock lives as long as the feature expiry says (or forever, if
none was set). Without that distinction, a tester's unlock would silently die the moment the
original short window closed, which is not what §13.2 describes.

**Clock tampering is explicitly not defended against** (§13.4) — no monotonic high-water mark, no
network time check. This is documented as a known limit of offline gatekeeping, not something to
fix later; §13.4 and §13.5 are explicit that neither this nor the installation id being derived on
the same machine it protects is a bug.

The installation id itself (§13.3) is a salted hash of a stable per-machine value already available
without new plumbing — `MachineGuid` on Windows, `/etc/machine-id` on Linux — truncated to
something a human can paste into a chat message. The raw per-machine value is read once to compute
the hash and never kept, shown or sent anywhere; only the salted, truncated hash is.

## Acceptance Criteria

- [x] **AC1** — A token that is validly signed, names a feature, whose installation id matches this
      machine's, and is redeemed inside its redemption window, is accepted for that feature.
- [x] **AC2** — A token whose signature does not verify against the embedded public key is
      rejected.
- [x] **AC3** — A token whose installation id does not match this machine's is rejected, and this
      failure is distinguishable from a bad signature (AC2) — not the same rejection reason.
- [x] **AC4** — A token redeemed after its redeem-by time is rejected; a token redeemed inside its
      window stays valid afterward regardless of what the window later does — the window is never
      re-checked once redemption has succeeded.
- [x] **AC5** — Verification re-runs on every app start, not only at the moment of redemption, so a
      feature expiry (AC7) takes effect on its own without any user action.
- [x] **AC6** — The raw per-machine value the installation id is derived from is never stored,
      displayed or transmitted by the launcher — only the salted, truncated hash is.
- [x] **AC7** — A token whose feature expiry has passed no longer unlocks that feature; this is
      checked at every re-verification (AC5) and is independent of the redemption window, which by
      then has already lapsed and is irrelevant per AC4.
- [x] **AC8** — `scripts/issue-unlock-code.mjs` issues a code for given feature names, an
      installation id and an optional feature expiry, signed with a private key it reads from
      outside the repository (path or environment variable); its default redeem-by is 24 hours after
      issued-at, and a code it issues is accepted by AC1's verification.
- [x] **AC9** — A code is one versioned-prefix base64url string (e.g. `q2l1.<payload>.<signature>`);
      input with a different prefix or a malformed body is rejected before any signature check. The
      installation id is 12 base32 characters, displayed grouped as `XXXX-XXXX-XXXX`.

## Open Questions

- [x] ~~**Q1 — Unlock-code distribution format.**~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Redemption window length.**~~ answered → Decisions (Sprint)
- [x] ~~**Q3 — Where the private key lives, and what the maintainer runs to issue a code.**~~
      answered → Decisions (Sprint)
- [x] ~~**Q4 — Installation id churn.**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

All four from concept open point #11, answered 2026-09-25 in planning:

- **(User)** Code format: **one base64url string with a versioned prefix**, meant to be pasted
  rather than typed. The installation id is 12 base32 characters grouped `XXXX-XXXX-XXXX` (AC9).
- **(User)** Redemption window: **24 hours**. Device binding does the real work; the window only
  keeps old codes from working later (AC8).
- **(User)** Private key and issuing: **the script lives in this repo, the key outside it**. The
  repo holds only the embedded public key, and tests use their own throwaway key pair (AC8).
- **(User)** Installation id churn: **the code is re-issued**, with no grace path. A code for an old
  id fails with the "wrong installation" reason (AC3).

Refine decisions (2026-09-25):

- **Wire format:** `q2l1.<b64url(JSON payload)>.<b64url(Ed25519 signature)>`; the signature covers
  the exact ASCII bytes `q2l1.<payloadB64>` — so the version prefix is signed too and nothing is
  re-serialised before verifying.
- **Payload fields:** `features` (1..16 names matching `^[a-z][a-z0-9-]{0,31}$`), `installId`,
  `issuedAt`, `redeemBy`, optional `expiresAt` (all integer epoch seconds), optional `label`
  (≤64 chars) — readable names, because the code is pasted, not typed.
- **One expiry per code**, applying to all its features — the payload lists "an optional feature
  expiry", singular, and per-feature expiries would buy nothing today.
- **Check order and reasons:** `malformed` → `badSignature` → `wrongInstallation` →
  `redemptionWindowElapsed` (redeem only) → `featureExpired`. That is cheapest-first and matches
  §13.6 plus AC9's "before any signature check"; 129 maps these five to its five messages.
- **Unknown feature names are accepted and simply granted** — the verifier checks syntax only, so a
  code issued for a newer build still redeems. What a name *does* is 130's business.
- **`issuedAt` is informational** — not-yet-valid is not checked; clock tampering is out of scope
  (§13.4).
- **Code name `launcherInstallId`**, UI label "installation id" — `installationId` already means a
  Quake II installation all over `src/`.
- **Salt is a fixed app constant** (`q2-launcher/unlock/v1`). A random salt kept in `state.json`
  would change the id on every state reset and force pointless re-issues.
- **id = first 60 bits of `sha256(salt + raw)`**, as 12 RFC 4648 base32 characters — AC9's length,
  with no ambiguity about which bits.
- **No machine value available** (read fails, missing file) means `launcherInstallId: null`, and
  every redemption fails with `wrongInstallation`. This adds no sixth reason: 129 has exactly five.
- **Stored codes that fail re-verification stay stored and inactive**, each with its last verdict.
  129 needs that verdict to say "expired" (its AC5), and redeeming the same code twice de-duplicates.
- **Redemption state is a new top-level `unlock` key in `state.json`** (`{ codes: [{ code,
  redeemedAt }] }`), with a forgiving schema. It follows the `servers`/`homeLayout` precedent: no
  schema-version bump.
- **Verification lives in main only**, in `src/main/services/unlock/`, a shell service (like
  `update`) and not a module: 130 has to query it *before* modules and IPC register. `src/shared/`
  gets only node-free types and formatting.
- **No IPC in this story.** The renderer surface (installation id, redeem, verdicts) is 129's; 128
  exposes the service that 129's handlers call.
- **Public-key override for tests:** `Q2L_UNLOCK_PUBLIC_KEY_FILE` is honoured only under the exact
  `registerDevIpc` condition (`isDev || Q2L_UI_HARNESS === '1'`). 129's e2e drives the packaged
  build under the harness flag, and §13.5 makes this gatekeeping, not a security boundary.
- **Production key:** the script's `keygen` writes the private key to
  `~/.q2-launcher/unlock-signing-key.pem`. It refuses paths inside the repo and never overwrites.
  Only the public PEM is committed, in `public-key.ts`.
- **No CHANGELOG entry** — nothing user-visible ships until 129.

## Plan

What 128 produces, for 129 and 130 to reference:

- `src/shared/unlock.ts` (node-free): `UNLOCK_CODE_PREFIX = 'q2l1'`,
  `type UnlockRejection = 'malformed'|'badSignature'|'wrongInstallation'|'redemptionWindowElapsed'|'featureExpired'`
  + `UNLOCK_REJECTIONS`, `FEATURE_NAME_PATTERN`, `formatLauncherInstallId(id) → 'XXXX-XXXX-XXXX'`,
  `normalizeLauncherInstallId(input) → string|null`, `UnlockSnapshot` type (below).
- `verifyUnlockCode(code, { publicKey, launcherInstallId, now, mode: 'redeem'|'reverify' })` →
  `{ ok: true, payload } | { ok: false, reason: UnlockRejection }` (pure, main,
  `src/main/services/unlock/verify.ts`).
- `UnlockService` on `AppContext.unlock` (`src/main/services/unlock/service.ts`):
  `init()` (awaited in `createAppContext` **before** `registerModules`), `isUnlocked(feature): boolean`
  — **the** "this code proves X is unlocked" check 130 gates on — `unlockedFeatures(): ReadonlySet<string>`,
  `redeem(code): UnlockVerdict`, `snapshot(): UnlockSnapshot` = `{ launcherInstallId: string|null,
  codes: [{ features, label, expiresAt, redeemedAt, status: 'active'|UnlockRejection }] }`.
  Redeem updates the in-memory set at once. Whether a newly unlocked gate takes effect live or on
  restart is 130's decision.

Order: D1 (format + verify) → D2 (install id) → D3 (issuing script + production key) → D4
(service, persistence, boot wiring, ARCHITECTURE note). D2 and D3 only need D1.

## Deliverables

- **D1 — Code format and verifier (pure).** Create `src/shared/unlock.ts` (the prefix constant, the
  `UnlockRejection` union + `UNLOCK_REJECTIONS`, `FEATURE_NAME_PATTERN`,
  `LAUNCHER_INSTALL_ID_PATTERN = /^[A-Z2-7]{12}$/`, `formatLauncherInstallId`,
  `normalizeLauncherInstallId` which strips `-`/whitespace, uppercases, and returns null if it does
  not match; `UnlockSnapshot`/`UnlockVerdict` types) — no `node:*`, no zod (reachable from preload).
  Create `src/main/services/unlock/code.ts`: `parseUnlockCode(raw)` — trim; split on `.` into
  exactly 3 parts; the prefix must equal `q2l1`; both bodies strict base64url (`[A-Za-z0-9_-]+`, no
  padding); the payload is JSON validated by a **strict** zod schema. Fields: `features` 1..16
  unique names matching the pattern; `launcherInstallId` matching the pattern; `issuedAt`,
  `redeemBy`, optional `expiresAt` as integer epoch seconds, with `redeemBy >= issuedAt` and
  `expiresAt > issuedAt`; optional `label` 1..64 chars. Any failure → `malformed`. It returns
  `{ payload, signedBytes: Buffer.from('q2l1.' + payloadB64, 'ascii'), signature }`. Add
  `encodeUnlockPayload(payload)` → the `q2l1.<payloadB64>` string to sign. Create
  `src/main/services/unlock/verify.ts`: `verifyUnlockCode(code, { publicKey: KeyObject | string
  (PEM), launcherInstallId: string | null, now: Date, mode })`. It uses `crypto.verify(null,
  signedBytes, publicKey, signature)` in `try/catch` → `badSignature`. The installation id must be
  equal and non-null, else `wrongInstallation`. **Only in `mode: 'redeem'`** does `now > redeemBy`
  → `redemptionWindowElapsed`. `expiresAt` present and `now >= expiresAt` → `featureExpired`. Order
  exactly as listed. Tests (throwaway `generateKeyPairSync('ed25519')` per suite) in
  `src/main/services/unlock/verify.test.ts` and `src/shared/unlock.test.ts` — names in Acceptance
  Tests. Mirror: pure-service + colocated test style of `src/main/services/launch-plan.ts`.
- **D2 — Launcher installation id.** Create `src/main/services/unlock/launcher-install-id.ts`:
  `deriveLauncherInstallId(raw: string): string` (pure: `sha256('q2-launcher/unlock/v1' +
  raw.trim().toLowerCase())`, first 60 bits → 12 base32 chars A–Z2–7), and
  `resolveLauncherInstallId(deps = { platform, readRegistry: regReadValue, readFile })` → `Promise<string|null>`.
  On win32 it uses `regReadValue('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid')`; on
  linux, `/etc/machine-id`, then falls back to `/var/lib/dbus/machine-id`. Any other platform, an
  empty value or an error → `null`. The raw value stays a local variable only: never returned,
  logged, cached or included in an error message. Test
  `src/main/services/unlock/launcher-install-id.test.ts` with injected deps (a spy logger asserts
  the raw value never appears). Reuse `src/main/lib/win-registry.ts` `regReadValue`, no new
  registry code.
- **D3 — Issuing script and production key.** Create `scripts/issue-unlock-code.mjs` (plain Node ESM,
  `node:crypto` only). Exported
  `issueUnlockCode({ features, launcherInstallId, expiresAt?, label?, now = new Date(), redeemHours = 24, privateKey })`
  builds the payload with `issuedAt = now` and `redeemBy = issuedAt + redeemHours*3600` (epoch
  seconds). It signs `q2l1.<b64url(JSON)>` with `crypto.sign(null, …)` and returns the full code.
  It validates features and id with the same rules as D1, and accepts a grouped or ungrouped id.
  `resolveSigningKeyPath({ argv, env, repoRoot })` takes `--key <path>`, else
  `Q2L_UNLOCK_SIGNING_KEY_FILE`, else `~/.q2-launcher/unlock-signing-key.pem`. It **throws if the
  resolved path is inside the repo root**. There are two CLI forms. The first is
  `node scripts/issue-unlock-code.mjs --features watchlist[,x] --install-id XXXX-XXXX-XXXX
  [--expires <ISO date> | --expires-in-days N] [--label "…"] [--key <path>]`, which prints the code
  plus a one-line summary. The second, `… keygen [--out <path>]`, writes a new pkcs8 PEM private
  key; it refuses paths inside the repo and refuses to overwrite, then prints the SPKI public PEM.
  Run `keygen` once, to the default home path. Put the printed public PEM into
  `src/main/services/unlock/public-key.ts` as `UNLOCK_PUBLIC_KEY_PEM`, with a comment on where the
  private key lives and that it must never enter the repo. Report the private-key path in the Done
  section. Test `scripts/issue-unlock-code.test.mjs`: throwaway keys; imports `verifyUnlockCode`
  from `../src/main/services/unlock/verify.ts` (vitest resolves it) for the round-trip. Mirror:
  `scripts/release.mjs` + `scripts/release.test.mjs` (export pure functions, CLI guarded by a
  main-module check).
- **D4 — UnlockService, persistence, boot wiring.** In `src/main/lib/schemas.ts`, add
  `parseUnlockState(raw)`, which is forgiving: rows of `{ code: string, redeemedAt: ISO string }`,
  bad rows dropped, capped at 32, deduped by code, `undefined` → `{ codes: [] }`. Mirror
  `parseServersState`. In `src/main/services/state.ts`, add an `unlock` top-level key,
  `unlockState()` / `setUnlockState()` (mirror `serversState`/`setServersState`), with no
  schema-version bump. Create `src/main/services/unlock/service.ts`: `UnlockService({ state,
  publicKey, resolveLauncherInstallId, now = () => new Date(), log })`. `init()` resolves the id
  once, then re-verifies every stored code with `mode: 'reverify'` (the window is never checked);
  the active features form the in-memory set, and a failing code stays stored with that status.
  `redeem(code)` verifies with `mode: 'redeem'`; on success it persists `{ code, redeemedAt: now }`,
  deduplicated, and recomputes the set, returning the verdict. It also provides
  `isUnlocked(feature)`, `unlockedFeatures()` and `snapshot()` (the `UnlockSnapshot` from D1). The
  service never logs the code body or the raw machine value. In `src/main/context.ts`, add
  `unlock: UnlockService` to `AppContext`, build it and `await unlock.init()` **before**
  `registerModules(context)`. The public key is `UNLOCK_PUBLIC_KEY_PEM`, or the file named by
  `Q2L_UNLOCK_PUBLIC_KEY_FILE` — but only when `isDev || process.env[UI_HARNESS_ENV] === '1'`
  (reuse the constant `src/main/ipc/index.ts` uses; export it if not already). Add a short
  "Unlock codes" section to `docs/ARCHITECTURE.md`: main-only verification, the two clocks, known
  limits §13.4/§13.5, and the API above. Test `src/main/services/unlock/service.test.ts` (in-memory
  `StateStore` over a temp file, the pattern in `src/main/services/state.test.ts`; throwaway keys;
  injected clock).

## Model Hints

- D1 → deliverable-hard — this is the security-relevant parser/verifier every later story trusts.
  The subtle wrong versions all look fine: verifying over re-serialised JSON instead of the exact
  signed bytes, letting non-strict base64url or a `crypto.verify` throw on a bad key escape as an
  exception instead of `badSignature`, or letting `mode` leak so the window is re-checked on
  re-verify.
- D2, D3, D4 → default.
- Review: → story-review-hard. Several plausible wrong implementations pass tests and a default
  review: the public-key override honoured in a plain packaged build (outside the
  isDev/harness gate), the raw MachineGuid reaching a log line or error message, the script's
  encoding drifting from D1's in an untested field (e.g. `label` or `expiresAt`), or a private-key
  path check that a relative path defeats. All of them are negative/structural behaviours on a
  signing boundary.

## Acceptance Tests

- AC1 → unit `src/main/services/unlock/verify.test.ts` › "a validly signed code for this installation inside its window is accepted"; unit `src/main/services/unlock/service.test.ts` › "redeeming a valid code unlocks its features and persists it"
- AC2 → unit `src/main/services/unlock/verify.test.ts` › "a tampered payload or a foreign key's signature is rejected as badSignature"
- AC3 → unit `src/main/services/unlock/verify.test.ts` › "a code for another installation is rejected as wrongInstallation, distinct from badSignature"
- AC4 → unit `src/main/services/unlock/verify.test.ts` › "redeeming after redeem-by is rejected as redemptionWindowElapsed"; unit `src/main/services/unlock/service.test.ts` › "a redeemed code stays unlocked after its redemption window has closed"
- AC5 → unit `src/main/services/unlock/service.test.ts` › "init re-verifies every stored code without any user action"
- AC6 → unit `src/main/services/unlock/launcher-install-id.test.ts` › "the raw machine value is never returned or logged"; unit `src/main/services/unlock/service.test.ts` › "persisted unlock state and logs never contain the raw machine value"
- AC7 → unit `src/main/services/unlock/verify.test.ts` › "a code past its feature expiry is rejected as featureExpired in both modes"; unit `src/main/services/unlock/service.test.ts` › "a stored code whose feature expiry has passed no longer unlocks at init"
- AC8 → unit `scripts/issue-unlock-code.test.mjs` › "a code issued by the script is accepted by verifyUnlockCode"; › "default redeem-by is 24 hours after issued-at"; › "the signing key comes from --key or Q2L_UNLOCK_SIGNING_KEY_FILE and never from inside the repo"
- AC9 → unit `src/main/services/unlock/verify.test.ts` › "a wrong prefix or malformed body is rejected as malformed before any signature check"; unit `src/shared/unlock.test.ts` › "an installation id is 12 base32 characters shown as XXXX-XXXX-XXXX"; unit `src/main/services/unlock/launcher-install-id.test.ts` › "the derived id is 12 base32 characters"

No criterion describes a user action through the UI; the redemption surface is [[129]]'s. So all
mappings are unit-level through the real main-side code, and none is a residue.

## Done

Built the launcher-wide unlock-code mechanism: `src/shared/unlock.ts` (wire-format constants,
`UnlockRejection`, id formatting), `src/main/services/unlock/{code,verify}.ts` (strict parser +
Ed25519 verifier, exact-signed-bytes, cheapest-first check order), `launcher-install-id.ts`
(salted-hash device id, Windows registry / Linux machine-id), `public-key.ts` (embedded
production public key), `service.ts` (`UnlockService` on `AppContext.unlock`, init-time
re-verification, persistence), `scripts/issue-unlock-code.mjs` (issuing CLI + `keygen`), plus
`state.ts`/`schemas.ts` persistence and a new "Unlock codes" section in `docs/ARCHITECTURE.md`.
Production private key generated to `C:\Users\darkp\.q2-launcher\unlock-signing-key.pem` (outside
the repo, never committed); its public half is embedded in `public-key.ts`.

**Commit message:** `128: an unlock code proves what it unlocks`

**Verification (narrow gate):** `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (942 tests) plus a separate
`npx vitest run scripts/issue-unlock-code.test.mjs` (18 tests, not picked up by `--changed`) —
both re-run clean after the two review-fix cycles. No e2e run: this story has no user-facing
surface (129 owns that), so all nine criteria are proven at the unit level, none is manual
residue.

**AC → test, as verified:** AC1 verify.test.ts "a validly signed code…accepted" + service.test.ts
"redeeming a valid code unlocks its features and persists it"; AC2 verify.test.ts "…badSignature";
AC3 verify.test.ts "…wrongInstallation, distinct from badSignature"; AC4 verify.test.ts
"…redemptionWindowElapsed" + service.test.ts "a redeemed code stays unlocked after its redemption
window has closed"; AC5 service.test.ts "init re-verifies every stored code without any user
action"; AC6 launcher-install-id.test.ts "the raw machine value is never returned or logged" +
service.test.ts "persisted unlock state and logs never contain the raw machine value"; AC7
verify.test.ts "…featureExpired in both modes" + service.test.ts "a stored code whose feature
expiry has passed no longer unlocks at init"; AC8 issue-unlock-code.test.mjs "a code issued by the
script is accepted by verifyUnlockCode" + "default redeem-by is 24 hours after issued-at" + "the
signing key comes from --key or Q2L_UNLOCK_SIGNING_KEY_FILE and never from inside the repo"; AC9
verify.test.ts "…malformed before any signature check" + unlock.test.ts "…XXXX-XXXX-XXXX" +
launcher-install-id.test.ts "…12 base32 characters". All passed.

**Review:** default-tier PASS with two test-quality findings, fixed (untested `label` round-trip
in the issuing-script test; a near-tautological AC6 service test whose fake resolver never
threaded a raw secret through code the service could touch) and re-verified green.
Hard-tier (`story-review-hard`) FAIL → four real findings, all fixed and re-verified green:
- **The repo-path guard in `issue-unlock-code.mjs` was case-insensitive-unsafe on Windows** —
  `assertOutsideRepo` compared resolved paths with a plain `startsWith` with no case
  normalization, so `c:\development\...\key.pem` (different case) bypassed the "refuse paths
  inside the repo" check that `C:\development\...\key.pem` correctly refused — confirmed
  exploitable against the real CLI. Fixed by lower-casing both sides before the prefix
  comparison.
- **The issuing script could sign codes D1's verifier rejects as `malformed`** — no validation
  that `expiresAt > issuedAt` or that `redeemBy` comes out as an integer, silently breaking AC8's
  "a code it issues is accepted". Fixed by validating both before signing and treating a nullish
  `expiresAt` as "omit the field" rather than coercing to `0`.
- **Unbounded stored-code growth could silently drop a redemption past 32 entries** — `redeem`
  appended without a cap while `parseUnlockState` truncates to 32 on load in an unspecified
  order. Fixed: `redeem` now explicitly keeps the newest 32 by `redeemedAt`.
- **Dedupe in `redeem` used the untrimmed code string**, so the same code with/without trailing
  whitespace stored twice. Fixed: trim before using as the dedupe key.
No findings left unfixed.

tiers: D 4 / hard 1 · review default+hard · cycles 2 · agents 10

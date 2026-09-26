# Unlock codes

Operator guide: set up the signing key, issue codes, redeem them. Background: stories
[128](../requirements/done/128-an-unlock-code-proves-what-it-unlocks.md),
[129](../requirements/done/129-i-ask-for-a-code-and-see-what-it-unlocked.md),
[130](../requirements/done/130-a-locked-feature-does-not-exist.md).

## How it works

- An unlock code is signed with an **Ed25519 private key** (yours, e.g. a Bitwarden SSH key).
- The launcher embeds the matching **public key** and checks every code against it.
- A code is bound to **one launcher installation** (machine-derived id) and lists the features it
  unlocks.
- A locked feature does not exist in the app: no tab, no menu entry, no IPC handler.

## Unlockable features

| Feature name | Unlocks |
| --- | --- |
| `watchlist` | *Watchlist* tab in the Servers view (marked experimental) |

Feature names are plain strings; a new gated feature is added in code (`<FeatureGate feature="…">`
in the renderer, `{ feature: '…' }` on the module's IPC handlers).

## One-time setup: SSH key from Bitwarden

Requirements: Node (repo checkout), Bitwarden desktop or web vault.

1. **Create the key** — Bitwarden → *New item* → *SSH key*. Key type must be **Ed25519** (default).
   RSA keys are refused.
2. **Embed the public key** — copy the *Public key* field (`ssh-ed25519 AAAA…`) and convert it:

   ```sh
   node scripts/issue-unlock-code.mjs pubkey "ssh-ed25519 AAAA… comment"
   ```

   Paste the printed `-----BEGIN PUBLIC KEY----- …` block into `UNLOCK_PUBLIC_KEY_PEM` in
   [src/main/services/unlock/public-key.ts](../../src/main/services/unlock/public-key.ts).
3. **Ship it** — build and release the launcher. Only builds containing the new key accept your
   codes.
4. **Store the private key for issuing** — copy the *Private key* field
   (`-----BEGIN OPENSSH PRIVATE KEY-----`, no passphrase) into
   `~/.q2-launcher/unlock-signing-key.pem` (Windows: `%USERPROFILE%\.q2-launcher\…`).
   Other location: pass `--key <path>` or set `Q2L_UNLOCK_SIGNING_KEY_FILE`.

> **Replacing the public key invalidates every code issued under the old key** — already redeemed
> ones included (they are re-verified on every start).

Key file rules:

- Never inside the repo — the script refuses such paths.
- Passphrase-protected OpenSSH keys are refused; export without passphrase.
- Delete the file after issuing if you prefer; Bitwarden stays the source of truth.

## Issue a code

1. The user opens **Settings → Unlock code**, copies the **Installation id** (`XXXX-XXXX-XXXX`) and
   sends it to you.
2. You run:

   ```sh
   node scripts/issue-unlock-code.mjs --features watchlist --install-id ABCD-EFGH-2345
   ```

3. Output: line 1 is the code (`q2l1.….…`), line 2 a summary (features, id, redeem-by, expiry,
   label). Send line 1 to the user.

| Option | Required | Meaning |
| --- | --- | --- |
| `--features a,b` | yes | 1–16 feature names, comma-separated |
| `--install-id <id>` | yes | installation id; case and hyphens don't matter |
| `--expires <date>` | no | features stop working at this date (ISO, e.g. `2027-01-01`) |
| `--expires-in-days <n>` | no | same, relative; not combinable with `--expires` |
| `--label <text>` | no | 1–64 chars, shown to the user next to the code |
| `--key <path>` | no | private key file (default `~/.q2-launcher/unlock-signing-key.pem`) |

Fixed rules:

- **Redeem window: 24 h** after issuing. Stored codes keep working after the window closes.
- No `--expires*` → features never expire.

## Redeem a code (user side)

1. **Settings → Unlock code** → paste the code → **Redeem**.
2. Accepted: features and expiry are listed. **Takes effect at the next launcher start.**
3. Rejected — the message says why:

| Message | Cause | Fix |
| --- | --- | --- |
| doesn't look like an unlock code | truncated / garbled | copy the full line again |
| isn't valid | signed with a different key than the launcher embeds | check key pair / launcher version |
| issued for a different installation | wrong installation id | issue a new code for the correct id |
| redemption window has passed | older than 24 h | issue a new code |
| features have already expired | `--expires` in the past | issue a new code |

Stored codes: in `state.json` under *Launcher data* (path shown in Settings → About), max 32.
Expired codes stay listed as expired and unlock nothing.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `pubkey`: expected "ssh-ed25519 AAAA" | key type is not Ed25519, or the line was cut off |
| issue: signing key must be Ed25519 | wrong key file |
| issue: refusing a signing-key path inside the repo | move the key file out of the repo |
| every code shows "isn't valid" | public key in `public-key.ts` doesn't match your private key — rerun `pubkey`, compare |
| code accepted, feature missing | restart the launcher |

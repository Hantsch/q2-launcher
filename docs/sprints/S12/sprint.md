---
sprint: S12
status: in-progress # planned | in-progress | done
branch: sprint/S12
milestone: Config, round three
---

# Sprint S12 — The file is the hero

## Goal

The rendered `.cfg` opens with a small name card instead of a technical header, Settings mirrors
the file's own cvar sections (every cvar in my file has a row, catalogue or not), and the Raw file
tab becomes an editor first: the code view gets the space, the admin around it shrinks to a toolbar
and one line per installation, and I can type a quick change straight into the file and Save.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 051 — The file header is a small banner, not a technical block
- [ ] 059 — Settings mirrors the file's own sections
- [ ] 057 — Raw file is an editor first, and I can edit inline

## Notes

**Order.** 051 first: it changes the first lines of every file and the ownership/rebuild readers
that depend on them, so 057's inline editing is built against the final header. 059 is the Settings
twin of S11's 052/053 and reuses their section model; it goes before 057 so the editor shows the
final file shape. 057 closes the sprint and carries its biggest UI decision (what text is edited).

**Carry-over rule applies to 051 and 059** — header readers in `writer.ts` / `canonical.ts` /
`rebuild.ts` / `profile-restore.ts`, cvar sections in `render.ts` / `profile-restore.ts`:
adversarial re-render pass, round-trip property re-run, no trust in diff reads.

**057 has a hard constraint from story 046:** the production CSP is `style-src 'self'`; any editor
technique that injects `<style>` at runtime (CodeMirror, Monaco) fails `ui:verify`'s CSP gate.
Refine verifies the chosen technique against the real production build before cutting deliverables.

**Parked for the clarification round:** 051's header look and whether the id stays in the file;
059's home for the always-written defaults (story 048) in an imported profile; 057's editing model
and where the per-installation rows go (they are also what 058 in S13 consolidates into Care).

032 (downloads badge) stays blocked on the downloads module.

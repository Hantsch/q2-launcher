# resources/bin

Vendored binaries the app spawns by absolute path, never from `PATH`.

- `7za.exe` - the standalone 7-Zip console extractor `src/main/modules/downloads/extractor.ts`
  spawns via `src/main/modules/downloads/7za-path.ts`. Not committed (see `.gitignore`); fetch it
  with `npm run fetch:7za` (`scripts/fetch-7za.mjs`). A missing binary is not fatal at runtime -
  extraction fails with the `downloads.error.extractorMissing` i18n key instead of throwing.
- `License.txt` - 7-Zip's licence, extracted alongside the binary by the same script. Safe to
  commit once present; kept here so the binary's licence ships next to it.

Both files land in the packaged app via `electron-builder.yml`'s `extraResources` entry for this
directory.

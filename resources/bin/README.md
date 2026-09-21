# resources/bin

Vendored binaries the app spawns by absolute path, never from `PATH`.

- `7za.exe` (Windows) / `7zz` (everywhere else) - the standalone 7-Zip console extractor
  `src/main/modules/downloads/extractor.ts` spawns via `src/main/modules/downloads/7za-path.ts`,
  which picks the binary name for the current `process.platform`. Neither is committed (see
  `.gitignore`); fetch the one for the host platform with `npm run fetch:7za`
  (`scripts/fetch-7za.mjs` - downloads and unpacks the official 7-Zip "extra" package on Windows,
  the official 7-Zip Linux x64 console build everywhere else). A missing binary is not fatal at
  runtime - extraction fails with the `downloads.error.extractorMissing` i18n key instead of
  throwing.
- `License.txt` - 7-Zip's licence, extracted alongside whichever binary was fetched, by the same
  script. Safe to commit once present; kept here so the binary's licence ships next to it.

These files land in the packaged app via `electron-builder.yml`'s platform-scoped `win:`/`linux:`
`extraResources` entries for this directory - each platform's build only ships its own binary.

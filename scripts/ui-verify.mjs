// D3 (docs/requirements/027-quiet-ui-verification.md): "the one command."
// Run via `npm run ui:verify`.
//
// Story 026 had this file spawn `shot.mjs` then `a11y.mjs` as two child
// processes and combine their exit codes. Story 027's unified driver
// (`scripts/verify.mjs`) already does both captures in one pass over one set
// of app launches, so there is nothing left to orchestrate here except
// calling it in-process, not as a spawned child. CLI args (e.g.
// `--screens=a,b`) are forwarded as-is — this file adds no `--skip-*` flags
// of its own, so both captures run by default.
//
// Deliberately NOT referenced by `test` or `build` (story 026 D6/AC9): this
// script is only ever invoked by a human or a build session running
// `npm run ui:verify` explicitly.
import { run } from './verify.mjs'

process.exitCode = await run(process.argv.slice(2))

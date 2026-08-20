// CLI entry for D2 (docs/requirements/026-ui-verification-harness.md): seeds
// the `populated` and `empty` fixtures the harness (`scripts/lib/harness.mjs`)
// launches the built app against. Run via `npm run ui:seed`.
//
// Idempotent by construction: `fixture.mjs` always deletes and rewrites each
// variant's directory from the same literal data, so running this twice in a
// row produces byte-identical files rather than merge-patching.
import { FIXTURE_VARIANTS, writeFixture } from './lib/fixture.mjs'

function main() {
  console.log('seeding UI-verification fixtures')
  for (const variant of FIXTURE_VARIANTS) {
    const summary = writeFixture(variant)
    console.log(
      `  ${variant}: ${summary.installations} installation(s), ` +
        `${summary.configProfiles} config profile(s) -> ${summary.userDataDir}`,
    )
  }
  console.log('done')
}

main()

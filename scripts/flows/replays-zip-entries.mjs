// Story 143 D4 acceptance flow: proves archive-entry demo rows actually surface on the real UI -
// the zip fixture's two real demo entries (one nested a level deep) show up as rows carrying
// `data-archive-entry="true"` and a "<source> › pack.zip › <entry path>" source line, the parsed
// map name renders for the entry whose header parses, the non-demo entry never becomes a row, and
// a loose fixture file still carries no `data-archive-entry` attribute at all. Mirrors
// `scripts/flows/replays-discovered-list.mjs`'s structure.
//
// Selectors, not guesses - read `src/renderer/src/modules/replays/ReplaysView.tsx` and
// `scripts/lib/fixture.mjs`'s `writeReplaysDemosFixture()`/`REPLAYS_FIXTURE_DEMOS` before changing
// any of these:
//   nav-replays              TitleBar.tsx - primary nav entry, `nav-${module.id}`
//   replays-demo-list        ReplaysView.tsx - the `<ul>` of discovered demos
//   replays-demo-row         ReplaysView.tsx - one `<li>` per demo, `data-archive-entry="true"`
//                             only when the row came from inside a zip
//   replays-demo-name        ReplaysView.tsx - the row's file name text
//   replays-demo-source      ReplaysView.tsx - "<base> › <archive> › <entry>" for an archive row
//   replays-demo-map         ReplaysView.tsx - the parsed map name, only present when known

import { REPLAYS_FIXTURE_DEMOS, vendoredExtractorExists } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

export default async function replaysZipEntries({ page, shot, step }) {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - the fixture only writes pack.zip with the REAL vendored ' +
        'extractor, and this flow will not pretend the archive-entry rows exist without it. Run ' +
        '`npm run fetch:7za` first.',
    )
  }

  step('navigating to the Demos view renders the discovered list')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })

  const list = page.getByTestId('replays-demo-list')
  await list.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('exactly two rows come from pack.zip')
  const zipRows = page
    .getByTestId('replays-demo-row')
    .filter({ has: page.getByTestId('replays-demo-source').filter({ hasText: 'pack.zip ›' }) })
  const zipRowCount = await zipRows.count()
  if (zipRowCount !== 2) {
    throw new Error(`replays-zip-entries: expected exactly 2 rows from pack.zip, got ${zipRowCount}`)
  }

  step('both pack.zip rows carry data-archive-entry="true"')
  for (let i = 0; i < zipRowCount; i += 1) {
    await zipRows.nth(i).evaluate((el, index) => {
      if (el.getAttribute('data-archive-entry') !== 'true') {
        throw new Error(`replays-zip-entries: row ${index} is missing data-archive-entry="true"`)
      }
    }, i)
  }

  step('the test.dm2 archive entry shows its parsed map name')
  const dm2Row = zipRows.filter({ has: page.getByTestId('replays-demo-name').filter({ hasText: 'test.dm2' }) })
  const dm2Map = await dm2Row.getByTestId('replays-demo-map').textContent()
  if (dm2Map !== 'q2rdm2') {
    throw new Error(`replays-zip-entries: test.dm2 map expected "q2rdm2", got "${dm2Map}"`)
  }

  step('the non-demo readme.txt entry never becomes a row')
  const readmeRows = await page.getByTestId('replays-demo-name').filter({ hasText: 'readme.txt' }).count()
  if (readmeRows !== 0) {
    throw new Error('replays-zip-entries: readme.txt must never appear as a demo row')
  }

  step('a loose fixture file carries no data-archive-entry attribute')
  const looseName = REPLAYS_FIXTURE_DEMOS.find((demo) => demo.fileName === 'FINAL.DM2').fileName
  const looseRow = page.getByTestId('replays-demo-row').filter({ hasText: looseName })
  const looseArchiveEntry = await looseRow.getAttribute('data-archive-entry')
  if (looseArchiveEntry !== null) {
    throw new Error(
      `replays-zip-entries: loose row ${looseName} must have no data-archive-entry attribute, got "${looseArchiveEntry}"`,
    )
  }

  await shot('replays-zip-entries')
}

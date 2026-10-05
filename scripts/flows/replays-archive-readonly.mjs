// Story 158 acceptance flow: an archive-entry demo's sidecar editor and rename control stay
// visible but disabled, each with its reason as VISIBLE text (not only a tooltip), while a loose
// demo shows neither. Mirrors `replays-zip-entries.mjs`'s setup/teardown (writes/removes
// `pack.zip` via the same fixture helpers) and row-finding selector.
//
// Selectors, not guesses - read `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`
// and `DemoFileActions.tsx` before changing any of these:
//   nav-replays                     TitleBar.tsx - primary nav entry
//   replays-demo-row / -name        ReplaysView.tsx - one row per demo / its file name text
//   replays-detail-input-name       DemoDetailPanel.tsx - the in-place name field (a plain text span
//                                    for an archive entry)
//   replays-archive-readonly-edit   DemoDetailPanel.tsx - visible reason the entry is read-only
//   demo-rename                     DemoFileActions.tsx - the rename button, disabled for an
//                                    archive entry
//   replays-archive-readonly-rename DemoDetailPanel.tsx - visible reason rename is disabled
//   replays-demo-reveal / -copy-path DemoFileActions.tsx - must stay enabled regardless

import {
  REPLAYS_FIXTURE_DEMOS,
  removeReplaysZipPackArchive,
  vendoredExtractorExists,
  writeReplaysZipPackArchive,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

// Same regression note as `replays-zip-entries.mjs`: `pack.zip` is built/removed by this flow
// alone, so every other flow reading the shared fixture folder stays archive-free at rest.
export async function setup() {
  writeReplaysZipPackArchive()
  return {}
}

export async function teardown() {
  removeReplaysZipPackArchive()
}

export default async function replaysArchiveReadonly({ page, shot, step }) {
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

  step('a zip entry shows the same view read-only with its reason')
  const dm2Row = page
    .getByTestId('replays-demo-row')
    .filter({ has: page.getByTestId('replays-demo-name').filter({ hasText: 'test.dm2' }) })
  await dm2Row.click({ timeout: TIMEOUT_MS })

  const name = page.getByTestId('replays-detail-input-name')
  await name.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  for (const field of ['name', 'date', 'map', 'mod', 'gamemode']) {
    const tag = await page
      .getByTestId(`replays-detail-input-${field}`)
      .evaluate((element) => element.tagName)
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      throw new Error(`replays-archive-readonly: ${field} must not be editable for an archive entry`)
    }
  }

  for (const id of [
    'replays-detail-favourite',
    ...Array.from({ length: 10 }, (_, i) => `replays-detail-rating-star-${i + 1}`),
  ]) {
    if (!(await page.getByTestId(id).isDisabled())) {
      throw new Error(`replays-archive-readonly: ${id} must be disabled for an archive entry`)
    }
  }

  const editNotice = page.getByTestId('replays-archive-readonly-edit')
  await editNotice.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const editNoticeText = await editNotice.textContent()
  if (editNoticeText !== 'Demos inside an archive are read-only — extract it to annotate it.') {
    throw new Error(`replays-archive-readonly: unexpected edit notice text "${editNoticeText}"`)
  }

  const renameButton = page.getByTestId('demo-rename')
  const renameDisabled = await renameButton.getAttribute('disabled')
  if (renameDisabled === null) {
    throw new Error(
      'replays-archive-readonly: the rename button must be disabled for an archive entry',
    )
  }

  const renameNotice = page.getByTestId('replays-archive-readonly-rename')
  await renameNotice.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const renameNoticeText = await renameNotice.textContent()
  if (renameNoticeText !== "Demos inside an archive can't be renamed — the archive is read-only.") {
    throw new Error(`replays-archive-readonly: unexpected rename notice text "${renameNoticeText}"`)
  }

  step('reveal and copy-path stay enabled for an archive entry')
  const revealDisabled = await page.getByTestId('replays-demo-reveal').getAttribute('disabled')
  if (revealDisabled !== null) {
    throw new Error('replays-archive-readonly: reveal must stay enabled for an archive entry')
  }
  const copyPathDisabled = await page.getByTestId('replays-demo-copy-path').getAttribute('disabled')
  if (copyPathDisabled !== null) {
    throw new Error('replays-archive-readonly: copy-path must stay enabled for an archive entry')
  }

  // Play ([[159]]/[[160]]): being an archive entry never locks it (160 plays a zip entry through a
  // temporary copy). In this populated fixture no installation has test.dm2's game dir
  // (`opentdm`), so the View button is present but disabled by the shared eligibility rule with its
  // `modMissing` reason as VISIBLE text - the same state a loose opentdm demo gets here. The archive-entry-plays-when-eligible half lives in
  // `replays-copy-in.mjs`.
  const playButton = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  if ((await playButton.count()) > 0) {
    const playDisabled = await playButton.getAttribute('disabled')
    if (playDisabled !== null) {
      const playReason = await page.getByTestId('actionbar-action-reason').textContent()
      if (!playReason || !/Mod `opentdm` missing/.test(playReason) || /archive/i.test(playReason)) {
        throw new Error(
          `replays-archive-readonly: Play is disabled for an archive entry, but its reason must be the ` +
            `mod-missing one, not an archive lock - got ${JSON.stringify(playReason)}`,
        )
      }
    }
  }

  step('a loose demo shows neither read-only notice')
  const looseName = REPLAYS_FIXTURE_DEMOS.find((demo) => demo.fileName === 'FINAL.DM2').fileName
  const looseRow = page.getByTestId('replays-demo-row').filter({ hasText: looseName })
  await looseRow.click({ timeout: TIMEOUT_MS })

  const looseEditNoticeCount = await page.getByTestId('replays-archive-readonly-edit').count()
  if (looseEditNoticeCount !== 0) {
    throw new Error(
      'replays-archive-readonly: a loose demo must not show the read-only edit notice',
    )
  }
  const looseRenameNoticeCount = await page.getByTestId('replays-archive-readonly-rename').count()
  if (looseRenameNoticeCount !== 0) {
    throw new Error(
      'replays-archive-readonly: a loose demo must not show the read-only rename notice',
    )
  }

  step(
    'the zip row disables its quick favourite control with a visible reason, the loose row does not',
  )
  const dm2FavouriteDisabled = await dm2Row
    .getByTestId('replays-row-favourite')
    .getAttribute('disabled')
  if (dm2FavouriteDisabled === null) {
    throw new Error('replays-archive-readonly: the zip row favourite control must be disabled')
  }
  await dm2Row
    .getByTestId('replays-archive-readonly-row')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const looseFavouriteDisabled = await looseRow
    .getByTestId('replays-row-favourite')
    .getAttribute('disabled')
  if (looseFavouriteDisabled !== null) {
    throw new Error('replays-archive-readonly: the loose row favourite control must stay enabled')
  }
  const looseRowNoticeCount = await looseRow.getByTestId('replays-archive-readonly-row').count()
  if (looseRowNoticeCount !== 0) {
    throw new Error(
      'replays-archive-readonly: the loose row must not show the read-only row notice',
    )
  }

  await shot('replays-archive-readonly')
}

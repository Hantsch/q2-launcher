// Story 061 D1 acceptance flow: the 30-visible-line budget the story's Decisions section sets for
// a config view's editor stops being a number in a doc and becomes something this flow measures
// on the real, running app - opens Plain Profile's Raw file tab (the one tab whose `.cfg-code`
// editor sits directly under the shell chrome with nothing else competing for height) and computes
// how many lines of the tokenised code view are actually visible, from real `clientHeight` and
// computed-style values, not from guessing pixel counts.
//
// Mirrors `scripts/flows/raw-inline-edit.mjs`'s step/shot/assert shape and its
// `RAW_TAB_LOAD_TIMEOUT_MS` constant/pattern (the Raw tab's own `getRawFiles` fetch is slow enough
// that a shorter timeout risks failing on load, not on the thing this flow actually checks).
//
// Selectors, not guesses:
//   nav-config          TitleBar.tsx
//   config-profile-row  ConfigView.tsx
//   config-tab-raw      ConfigView.tsx (`{ id: 'raw', label: t('config.tabs.raw') }`)
//   .cfg-code           ConfigCodeView.tsx / config-syntax.css - the scrolling grid container
//                       whose `clientHeight` is the editor's actual visible box; `padding-block`
//                       (`--cfg-code-pad`, 12px) and `--cfg-code-line-h` (17px) are declared on it
//                       as CSS custom properties, read here the same way any consumer would: via
//                       `getComputedStyle` inside `page.evaluate`, never hand-duplicated as a
//                       literal in this file.
//
// The formula mirrors the story's own Decisions math exactly:
//   lines  = floor((clientHeight - paddingTop - paddingBottom) / lineHeight)
//   margin = clientHeight - paddingTop - paddingBottom - 30 * lineHeight
// `margin` is headroom above the story's 30-line floor in px, not a line count - positive means
// there is still chrome budget left before a future change would drop below 30 visible lines.
//
// This flow does not change layout - it is the measuring instrument the story's Decisions math
// gets checked against, not a fix. It must be green against today's unmodified code: the story's
// own baseline is 32 visible lines (66px chrome above the editor, 104px allowance).
//
// Story 061 D4 extends this same flow with the header's own promises (AC1-AC5), turned into
// assertions against the real DOM/geometry D3 produced:
//   config-profile-header    ConfigView.tsx - one header row per tab (AC1)
//   config-profile-identity  ConfigView.tsx - name/created/updated/`UnsavedIndicator`, centred (AC2)
//   config-profile-actions   ConfigView.tsx - Save/Discard/Assignments/Rename/Delete cluster
//   config-tab-strip         ConfigView.tsx - the tab-button row below the header (AC3)
//   config-unsaved-indicator UnsavedIndicator.tsx - only rendered while `useUnsavedState` is dirty,
//                             read off the real component rather than assumed from the story text
//   config-save/config-discard  ProfileSaveActions.tsx - in `config-profile-actions`; `config-discard`
//                             calls `rawDraft.discard()` directly (no confirm dialog) while a raw
//                             draft is the thing that is unsaved, which is what this flow uses to
//                             undo its own keystroke without touching disk
import { resize } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000
/** The Raw file tab's own `getRawFiles` fetch (real IPC, reads the profile's canonical file plus
 * every assigned installation's copy off disk) has been observed taking noticeably longer than
 * `TIMEOUT_MS` to settle - mirrors `RAW_TAB_LOAD_TIMEOUT_MS` in `scripts/flows/raw-inline-edit.mjs`
 * and `scripts/lib/screens.mjs`. */
const RAW_TAB_LOAD_TIMEOUT_MS = 20_000

/** Story 061's Decisions: the config-view line budget a config editor must fit at least this many
 * visible lines within. */
const MIN_VISIBLE_LINES = 30

/** AC5's own floor (`scripts/lib/screens.mjs`'s `VIEWPORT_MIN`) - the smallest size the shell is
 * expected to render at without clipping the header. */
const SMALL_VIEWPORT = { width: 940, height: 620 }

/** The zones D3 gave a stable testid, whose bounding rects this flow compares tab to tab as the
 * geometric proof of AC1/AC3 - one header row, one centred identity block, one tab strip, one
 * action cluster, on every tab. */
const ZONE_IDS = [
  'config-profile-header',
  'config-profile-identity',
  'config-tab-strip',
  'config-profile-actions',
]

/** The six tabs whose header sits over a profile that is not, itself, in the middle of an unsaved
 * edit - captured first, while every one of them should read as byte-for-byte identical chrome.
 * `unsaved` (the seventh tab) only exists once the flow itself puts the profile in that state, so
 * it is measured separately, against the same baseline, once it exists. */
const CLEAN_TABS = ['overview', 'settings', 'controls', 'aliases', 'care', 'raw']

async function captureZoneRects(page) {
  const rects = {}
  for (const testId of ZONE_IDS) {
    rects[testId] = await page.getByTestId(testId).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
  }
  return rects
}

/** `field` is `'rect'` (x/y/width/height must all match - the header and tab strip never resize
 * or reflow across a plain tab switch) or `'yh'` (only `y`/`height` must match - the identity and
 * action zones legitimately change *width* when their content does, e.g. the unsaved indicator or
 * the Save/Discard pair appearing, but never move vertically or change row height for that). */
function assertZoneStable(byTab, testId, field) {
  const tabs = Object.keys(byTab)
  const reference = byTab[tabs[0]][testId]
  for (const tab of tabs.slice(1)) {
    const rect = byTab[tab][testId]
    const keys = field === 'rect' ? ['x', 'y', 'width', 'height'] : ['y', 'height']
    for (const key of keys) {
      if (Math.round(rect[key]) !== Math.round(reference[key])) {
        throw new Error(
          `${testId}.${key} differs between tab '${tabs[0]}' (${reference[key]}) and tab ` +
            `'${tab}' (${rect[key]}) - expected the same chrome on every tab (AC1/AC3)`,
        )
      }
    }
  }
}

async function assertHitTestable(page, locator, name) {
  await locator.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const box = await locator.boundingBox()
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`${name} has no usable bounding box at 940x620 - got ${JSON.stringify(box)}`)
  }
  const viewport = page.viewportSize()
  if (viewport && (box.x < 0 || box.y < 0 || box.x + box.width > viewport.width)) {
    throw new Error(
      `${name} is clipped outside the ${viewport.width}x${viewport.height} viewport - ` +
        `box=${JSON.stringify(box)}`,
    )
  }
}

export default async function configHeaderGeometry({ page, app, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  step('select Plain Profile')
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })

  step('open Raw file tab')
  await page.getByTestId('config-tab-raw').click({ timeout: TIMEOUT_MS })

  // The Raw tab can render more than one `.cfg-code` view (the profile's own canonical file, plus
  // one per assigned installation's copy) - the profile's own canonical view is always the first
  // one in DOM order (`RawFileTab.tsx` renders it before the per-installation list), so `.first()`
  // is the one whose geometry this flow measures.
  const codeView = page.locator('.cfg-code').first()
  await codeView.waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })

  step('measure the visible line count from real geometry')
  const geometry = await codeView.evaluate((el) => {
    const style = getComputedStyle(el)
    const paddingTop = parseFloat(style.paddingTop) || 0
    const paddingBottom = parseFloat(style.paddingBottom) || 0
    const lineHeight = parseFloat(style.getPropertyValue('--cfg-code-line-h')) || 0
    return {
      clientHeight: el.clientHeight,
      paddingTop,
      paddingBottom,
      lineHeight,
    }
  })

  if (!(geometry.lineHeight > 0)) {
    throw new Error(
      `could not read a usable --cfg-code-line-h off .cfg-code - got ${JSON.stringify(geometry)}`,
    )
  }

  const paddingTotal = geometry.paddingTop + geometry.paddingBottom
  const usableHeight = geometry.clientHeight - paddingTotal
  const lines = Math.floor(usableHeight / geometry.lineHeight)
  const margin = usableHeight - MIN_VISIBLE_LINES * geometry.lineHeight

  console.log(`lines=${lines} margin=${Math.round(margin)}px`)

  await shot('raw-tab')

  if (lines < MIN_VISIBLE_LINES) {
    throw new Error(
      `expected at least ${MIN_VISIBLE_LINES} visible lines in the Raw file tab's editor, got ` +
        `${lines} (clientHeight=${geometry.clientHeight}px padding=${paddingTotal}px ` +
        `lineHeight=${geometry.lineHeight}px)`,
    )
  }

  // --- AC1/AC3: one header row, identical chrome, on every tab -----------------------------------
  step('capture header/identity/tab-strip/actions geometry on every clean tab')
  const byTab = {}
  for (const tabId of CLEAN_TABS) {
    await page.getByTestId(`config-tab-${tabId}`).click({ timeout: TIMEOUT_MS })
    if (tabId === 'raw') {
      await page.locator('.cfg-code').first().waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })
    }
    byTab[tabId] = await captureZoneRects(page)
  }

  assertZoneStable(byTab, 'config-profile-header', 'rect')
  assertZoneStable(byTab, 'config-tab-strip', 'rect')
  assertZoneStable(byTab, 'config-profile-identity', 'rect')
  assertZoneStable(byTab, 'config-profile-actions', 'rect')

  console.log(
    `header/identity/tab-strip/actions rects identical across ${CLEAN_TABS.length} clean tabs: ` +
      `${CLEAN_TABS.join(', ')}`,
  )

  // --- AC1: the header is a single row, not a wrap in disguise -------------------------------------
  // `assertZoneStable` above only proves the header's rect is the *same* on every tab - a header
  // that wrapped to two rows on every tab would still pass that. The story's own text is "height <=
  // one control row"; the back button is the one control guaranteed to render inside the header on
  // every tab, so its own rendered height is the non-magic-number yardstick - a single-row header
  // should be at most about 2x that tall, which a genuinely-wrapped two-row header would blow past.
  step('assert the header is a single row, not a wrap (AC1)')
  const backButtonBox = await page
    .getByTestId('config-profile-header')
    .getByRole('button', { name: 'Back to profiles' })
    .boundingBox()
  if (!backButtonBox || backButtonBox.height <= 0) {
    throw new Error('could not measure the back button to establish a single-row height ceiling')
  }
  const headerHeight = byTab[CLEAN_TABS[0]]['config-profile-header'].height
  const singleRowCeiling = backButtonBox.height * 2
  if (headerHeight > singleRowCeiling) {
    throw new Error(
      `config-profile-header is ${Math.round(headerHeight)}px tall, more than 2x the back ` +
        `button's own ${Math.round(backButtonBox.height)}px height - looks like it has wrapped ` +
        `to a second row (AC1 requires a single row)`,
    )
  }
  console.log(
    `header height ${Math.round(headerHeight)}px is within the single-row ceiling of ` +
      `${Math.round(singleRowCeiling)}px (2x the back button's ${Math.round(backButtonBox.height)}px)`,
  )

  // --- AC2: the identity zone actually names the profile -----------------------------------------
  step('assert the identity zone contains the profile name, created and updated values')
  await page.getByTestId('config-tab-overview').click({ timeout: TIMEOUT_MS })
  const identityText = await page.getByTestId('config-profile-identity').innerText()
  // The name renders through `uppercase` (`font-display ... uppercase`), so `innerText` reads it
  // shouty regardless of how the profile was actually named - compared case-insensitively rather
  // than hard-coding the transformed casing as if it were the real string.
  const identityTextLower = identityText.toLowerCase()

  if (!identityTextLower.includes('plain profile')) {
    throw new Error(`identity zone does not name the profile - got ${JSON.stringify(identityText)}`)
  }
  if (!identityTextLower.includes('created') || !identityTextLower.includes('updated')) {
    throw new Error(
      `identity zone is missing the Created/Updated labels - got ${JSON.stringify(identityText)}`,
    )
  }
  // Each label must be followed by an actual value, not a bare '-' fallback (`formatRelativeTime`'s
  // own "nothing to show" case) - a real profile freshly seeded by the fixture always has both.
  if (/created\s*-(\s|$)/.test(identityTextLower) || /updated\s*-(\s|$)/.test(identityTextLower)) {
    throw new Error(
      `identity zone shows a placeholder '-' instead of a real created/updated value - got ` +
        `${JSON.stringify(identityText)}`,
    )
  }

  // AC2's own text is "no second identity block anywhere" - the checks above only prove the one
  // canonical zone has the right content, never that it is the only one. `count()` catches a
  // duplicate that reused the same testid; the `evaluate` below catches a duplicate that did not -
  // any element outside the canonical zone's own subtree (and not one of its ancestors, which
  // trivially contain its text too) that still carries the same name+created+updated combination.
  const identityCount = await page.getByTestId('config-profile-identity').count()
  if (identityCount !== 1) {
    throw new Error(
      `expected exactly one config-profile-identity zone in the DOM, found ${identityCount}`,
    )
  }
  const strayIdentityFound = await page.evaluate(
    ({ name, created, updated }) => {
      const identityZone = document.querySelector('[data-testid="config-profile-identity"]')
      if (!identityZone) return false
      return Array.from(document.querySelectorAll('body *')).some((el) => {
        if (el === identityZone) return false
        if (el.contains(identityZone)) return false // ancestor of the canonical zone
        if (identityZone.contains(el)) return false // inside the canonical zone
        const text = (el.textContent || '').toLowerCase()
        return text.includes(name) && text.includes(created) && text.includes(updated)
      })
    },
    { name: 'plain profile', created: 'created', updated: 'updated' },
  )
  if (strayIdentityFound) {
    throw new Error(
      'found an element outside the canonical config-profile-identity zone that also carries ' +
        "the profile's name plus Created/Updated text - looks like a second identity block (AC2)",
    )
  }
  console.log('exactly one config-profile-identity zone exists, with no stray duplicate elsewhere')

  await shot('identity-overview')

  // --- AC2/AC3: the unsaved indicator, and a seventh tab whose chrome still matches ---------------
  step('type a keystroke in the raw editor and assert the unsaved indicator appears')
  await page.getByTestId('config-tab-raw').click({ timeout: TIMEOUT_MS })
  const textarea = page.locator('.cfg-code-textarea')
  await textarea.waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })
  await textarea.click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n// q2l_flow_header_geometry_probe')

  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-unsaved').click({ timeout: TIMEOUT_MS })

  const indicator = page.getByTestId('config-profile-identity').getByTestId('config-unsaved-indicator')
  await indicator.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  byTab.unsaved = await captureZoneRects(page)
  assertZoneStable(byTab, 'config-profile-header', 'rect')
  assertZoneStable(byTab, 'config-tab-strip', 'rect')
  assertZoneStable(byTab, 'config-profile-identity', 'yh')
  assertZoneStable(byTab, 'config-profile-actions', 'yh')

  console.log('header/tab-strip rects, and identity/actions y+height, hold across all seven tabs')

  await shot('unsaved-indicator')

  // --- AC5: the header survives the app's minimum window size -------------------------------------
  step('resize to 940x620 and assert the header does not clip or overflow')
  await resize(app, SMALL_VIEWPORT)

  const overflow = await page.getByTestId('config-profile-header').evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  if (overflow.scrollWidth > overflow.clientWidth) {
    throw new Error(
      `config-profile-header overflows at 940x620 - scrollWidth=${overflow.scrollWidth} > ` +
        `clientWidth=${overflow.clientWidth}`,
    )
  }

  const header = page.getByTestId('config-profile-header')
  await assertHitTestable(page, header.getByRole('button', { name: 'Back to profiles' }), 'back button')
  await assertHitTestable(page, page.getByTestId('config-save'), 'Save button')
  await assertHitTestable(page, page.getByTestId('config-discard'), 'Discard button')
  const actions = page.getByTestId('config-profile-actions')
  await assertHitTestable(page, actions.getByRole('button', { name: 'Rename…' }), 'Rename button')
  await assertHitTestable(page, actions.getByRole('button', { name: 'Delete…' }), 'Delete button')

  const tabButtons = await page.getByTestId('config-tab-strip').locator('button').all()
  for (const button of tabButtons) {
    const label = (await button.innerText()).trim() || '(unlabeled tab button)'
    await assertHitTestable(page, button, `tab button '${label}'`)
  }

  console.log(
    `header fits at 940x620 with no overflow; back/Save/Discard/Rename/Delete/${tabButtons.length} ` +
      `tab buttons all hit-testable`,
  )

  await shot('small-viewport')

  // Undo the keystroke this flow itself typed - a raw draft never touches disk until Save is
  // clicked, so there is nothing to reload out of `.ui-verify/fixture` here, but leaving the app
  // mid-draft would still be a false "still unsaved" signal for anyone reading `shot`s from this
  // run. `config-discard` calls `rawDraft.discard()` directly for a raw-edited profile (no confirm
  // dialog - `ProfileSaveActions.tsx`), so a single click is enough.
  step('discard the probe keystroke')
  await page.getByTestId('config-discard').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
}

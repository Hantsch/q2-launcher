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
//
// Story 069 D1 extends this flow again, this time with a second measurement: the Raw tab's
// `'lockedByChanges'` shape (`rawEditingMode`, `lib/raw-draft.tsx`), reached on purpose (D-15) by
// toggling the `writeUnbindall` checkbox (`markUnsaved`, `src/main/modules/config/index.ts:616`)
// and left again via `config-discard` + `DiscardChangesDialog`'s confirm button, which restores
// `writeUnbindall` from the baseline the fixture already seeds. `measureVisibleLines` below is the
// one formula both shapes are measured with, extracted rather than copied so the two numbers can
// never silently drift apart.
//
// Story 069 D2 moved the locked hint into the merged toolbar row itself (`config-raw-toolbar-row`,
// `RawFileTab.tsx`) as one more `Badge`, replacing the standalone hint paragraph D1's measurement
// above was taken against - this flow's `lockedByChanges` block now also asserts real DOM
// containment (`config-raw-locked-hint` is a descendant of `config-raw-toolbar-row`) and that the
// row still renders as one line at 1280x800, and the locked shape's own line/margin numbers are
// expected to rise to match the editable shape now that the standalone hint's line is gone.
//
// Story 069 D3 turns the header's identity zone into two lines (name + unsaved indicator, then
// created/updated) and turns AC1-AC3/AC5 into assertions against the real geometry that produced:
//   config-profile-identity  ConfigView.tsx - still exactly ONE element (D-4), now with exactly two
//                            element children: row 1 = the `h2` + `config-unsaved-indicator`,
//                            row 2 = the two `KeyValue`s. `readIdentityZone` below reads the whole
//                            shape - child rows, their rects, and every *text-bearing* element's
//                            computed `font-size`/`color` - in one `evaluate`, so AC1 (row 2 below
//                            row 1) and AC2 (row 2 smaller and dimmer) are checked against what
//                            the browser actually resolved the token chain to. No colour literal
//                            appears in this file: "dimmer" is relative luminance (WCAG) measured
//                            against the real surface behind the header, found by walking up to the
//                            nearest ancestor with a non-transparent background.
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching
// (`scripts/flow.mjs`'s `withApp()` opens `.ui-verify/fixture/populated/userdata` as-is) - and this
// flow's very first measurement assumes Plain Profile is clean (`profile.dirty === false`), the
// precondition `rawEditingMode` requires for the `'editable'` shape. Running `npm run ui:verify`'s
// full registry, or a previous run of this flow that failed before its own restore step, leaves
// Plain Profile dirty - which would route the first measurement into the `'lockedByChanges'` shape
// instead of `'editable'`, silently checking the wrong floor. Run `npm run ui:seed` first if the
// fixture's last known state is not certain to be clean - the same precondition `raw-inline-edit.mjs`
// documents, for the same reason (D-10).
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

/** The one formula both the `editable` and `lockedByChanges` shapes are measured with (story 069
 * D1) - extracted out of the first measurement rather than copied for the second, so the two
 * numbers this flow prints can never silently drift onto different arithmetic. Mirrors the story's
 * own Decisions math exactly:
 *   lines  = floor((clientHeight - paddingTop - paddingBottom) / lineHeight)
 *   margin = clientHeight - paddingTop - paddingBottom - MIN_VISIBLE_LINES * lineHeight
 * `margin` is headroom above the floor in px, not a line count - positive means there is still
 * chrome budget left before a future change would drop below `MIN_VISIBLE_LINES` visible lines.
 * Throws if `--cfg-code-line-h` cannot be read, the same failure both call sites need to report. */
async function measureVisibleLines(codeView) {
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

  return { lines, margin, geometry, paddingTotal }
}

/** Story 069 D3 (AC1/AC2): the identity zone's whole rendered shape, in one pass over the live DOM.
 *
 * Everything AC1 and AC2 talk about is a *relationship* between things the browser computed, never
 * a pixel or a hex value this file could hardcode: how many child rows the zone has and where they
 * sit relative to each other, and how each text-bearing element's `font-size` and `color` compare to
 * the `h2`'s. `color` is returned both raw and as a WCAG relative luminance, together with the
 * luminance of the surface the header actually sits on (the nearest ancestor with a non-transparent
 * background, resolved at runtime) - so "dimmer" can be asserted as "closer to the background than
 * the name is" without this script knowing a single token value.
 *
 * "Text element" means an element with a non-empty text node of its own, not a wrapper around
 * elements that have one - otherwise every ancestor would count as text at its own inherited size
 * and the comparison would be meaningless. Alpha < 1 is ignored in the luminance maths: every text
 * token in the ink ramp is fully opaque, and a translucent one would only ever read *dimmer*, which
 * is the direction the assertion wants anyway. */
async function readIdentityZone(page) {
  return page.getByTestId('config-profile-identity').evaluate((zone) => {
    const rectOf = (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom }
    }
    const channels = (color) => (color.match(/[\d.]+/g) || []).map(Number)
    /** WCAG 2.x relative luminance of a `getComputedStyle` colour, or `null` if unparseable. */
    const luminance = (color) => {
      const parts = channels(color).slice(0, 3)
      if (parts.length < 3) return null
      const [r, g, b] = parts.map((c) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const isOpaque = (color) => {
      const parts = channels(color)
      return parts.length >= 3 && (parts.length < 4 || parts[3] > 0)
    }
    const backgroundOf = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor
        if (isOpaque(bg)) return bg
      }
      return getComputedStyle(document.documentElement).backgroundColor
    }
    const textElements = (root) =>
      Array.from(root.querySelectorAll('*')).filter((el) =>
        Array.from(el.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim() !== '',
        ),
      )
    const describe = (el) => {
      const style = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        fontSize: parseFloat(style.fontSize),
        color: style.color,
        luminance: luminance(style.color),
      }
    }

    const header = zone.closest('[data-testid="config-profile-header"]')
    const h2 = zone.querySelector('h2')
    const background = backgroundOf(zone)

    return {
      rect: rectOf(zone),
      childCount: zone.children.length,
      rows: Array.from(zone.children).map((row) => ({
        rect: rectOf(row),
        text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
        hasH2: row.querySelector('h2') !== null,
        testIds: Array.from(row.querySelectorAll('[data-testid]')).map((el) => el.dataset.testid),
        textElements: textElements(row).map(describe),
      })),
      h2: h2 === null ? null : describe(h2),
      background,
      backgroundLuminance: luminance(background),
      headerTextElements: header === null ? [] : textElements(header).map(describe),
    }
  })
}

/** Story 069 D3 (AC3): the header's own direct children, left to right, with the two the criterion
 * names (the back button, the action cluster) flagged - so "still the leftmost/rightmost child" and
 * "still centred against the taller identity zone" are read off real rects rather than assumed from
 * the class list. `backLabel` is passed in rather than duplicated in the page context, so the one
 * label string in this file stays the one the rest of the flow already targets by role. */
async function readHeaderEdges(page, backLabel) {
  return page.getByTestId('config-profile-header').evaluate((header, label) => {
    const headerRect = header.getBoundingClientRect()
    return {
      centerY: headerRect.y + headerRect.height / 2,
      children: Array.from(header.children).map((el, index) => {
        const r = el.getBoundingClientRect()
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
        return {
          index,
          testId: el.dataset.testid ?? null,
          label: el.dataset.testid ?? (text.slice(0, 40) || el.tagName.toLowerCase()),
          x: r.x,
          right: r.right,
          centerY: r.y + r.height / 2,
          isBack: el.tagName.toLowerCase() === 'button' && text.includes(label),
          isActions: el.dataset.testid === 'config-profile-actions',
        }
      }),
    }
  }, backLabel)
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
  const { lines, margin, geometry, paddingTotal } = await measureVisibleLines(codeView)

  console.log(`editable lines=${lines} margin=${Math.round(margin)}px`)

  await shot('raw-tab')

  if (lines < MIN_VISIBLE_LINES) {
    throw new Error(
      `expected at least ${MIN_VISIBLE_LINES} visible lines in the Raw file tab's editor, got ` +
        `${lines} (clientHeight=${geometry.clientHeight}px padding=${paddingTotal}px ` +
        `lineHeight=${geometry.lineHeight}px)`,
    )
  }

  // --- D1 (story 069): the lockedByChanges shape, measured on purpose ----------------------------
  // Reached by toggling the raw tab's own `writeUnbindall` checkbox (D-15) - a structured change
  // (`markUnsaved`) that makes `profile.dirty` true and routes `rawEditingMode` into
  // `'lockedByChanges'`, which renders the read-only `ConfigCodeView` branch instead of the
  // editable textarea. That branch's find bar (`.cfg-code-search`) is on-demand as of this story
  // (D1/D-13): hidden until Ctrl+F opens it, gone again on Escape.
  step('toggle writeUnbindall to enter the lockedByChanges shape (D-15)')
  // The checkbox's own `<input>` is visually `sr-only` (Checkbox, `components/ui/controls.tsx`) -
  // its real hit target for a pointer is the label's visible text, exactly what a sighted user
  // actually clicks and what `scripts/lib/screens.mjs`'s `config-conflict-dialog` screen already
  // targets for the same checkbox - not the role=checkbox element itself, whose collapsed hit box
  // the visual indicator span sits on top of and intercepts.
  const writeUnbindallLabel = page.getByText('Start the file with `unbindall`', { exact: true })
  await writeUnbindallLabel.waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })
  await writeUnbindallLabel.click({ timeout: TIMEOUT_MS })

  step('wait for the read-only view and measure the lockedByChanges shape (AC4)')
  // Toggling the checkbox bumps `profile.updatedAt`, which re-triggers the tab's own `getRawFiles`
  // fetch (`RawFileTab.tsx`'s effect deps) - the same slow real-IPC read `RAW_TAB_LOAD_TIMEOUT_MS`
  // exists for elsewhere in this file, not the shorter default `TIMEOUT_MS`.
  await page
    .getByTestId('config-raw-locked-hint')
    .waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const lockedCodeView = page.locator('.cfg-code').first()
  await lockedCodeView.waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })

  const lockedMeasurement = await measureVisibleLines(lockedCodeView)
  console.log(
    `lockedByChanges lines=${lockedMeasurement.lines} margin=${Math.round(lockedMeasurement.margin)}px`,
  )

  await shot('raw-tab-locked')

  if (lockedMeasurement.lines < MIN_VISIBLE_LINES) {
    throw new Error(
      `expected at least ${MIN_VISIBLE_LINES} visible lines in the Raw file tab's editor while ` +
        `lockedByChanges, got ${lockedMeasurement.lines} (clientHeight=` +
        `${lockedMeasurement.geometry.clientHeight}px padding=${lockedMeasurement.paddingTotal}px ` +
        `lineHeight=${lockedMeasurement.geometry.lineHeight}px)`,
    )
  }

  // --- D2 (story 069): the locked hint lives in the merged toolbar row, not a standalone line -----
  // Proven two ways: real DOM containment (`Element.contains`, not a y-coordinate guess that a
  // visually-overlapping-but-unrelated element could satisfy by accident), and that the row this
  // hint now lives in still renders as one line at 1280x800 - the same "no wrap" contract AC1 checks
  // for `config-profile-header`, reused here at the smaller scale of this one row via the same
  // known-single-row-element-height-ceiling idiom (the locked hint badge itself is guaranteed to
  // render on the row's one line, so 2x its own height is a wrap detector that needs no new magic
  // number).
  step('assert config-raw-locked-hint is a DOM descendant of the merged toolbar row (D2)')
  const toolbarRow = page.getByTestId('config-raw-toolbar-row')
  const lockedHint = page.getByTestId('config-raw-locked-hint')

  const hintIsInsideRow = await toolbarRow.evaluate((row) => {
    const hint = row.querySelector('[data-testid="config-raw-locked-hint"]')
    return hint !== null && row.contains(hint)
  })
  if (!hintIsInsideRow) {
    throw new Error(
      'config-raw-locked-hint is not a DOM descendant of config-raw-toolbar-row - expected the ' +
        'locked hint (D2) to live inside the merged toolbar row, not as a standalone element',
    )
  }

  const toolbarRowBox = await toolbarRow.boundingBox()
  const lockedHintBox = await lockedHint.boundingBox()
  if (!toolbarRowBox || !lockedHintBox) {
    throw new Error(
      'could not measure config-raw-toolbar-row/config-raw-locked-hint to check the row is one line',
    )
  }
  const toolbarRowSingleLineCeiling = lockedHintBox.height * 2
  if (toolbarRowBox.height > toolbarRowSingleLineCeiling) {
    throw new Error(
      `config-raw-toolbar-row is ${Math.round(toolbarRowBox.height)}px tall, more than 2x the ` +
        `locked hint badge's own ${Math.round(lockedHintBox.height)}px height - looks like the row ` +
        `has wrapped to a second line at 1280x800 (D2 expects one line)`,
    )
  }
  console.log(
    `config-raw-locked-hint is a DOM descendant of config-raw-toolbar-row; the row is ` +
      `${Math.round(toolbarRowBox.height)}px tall, within the single-line ceiling of ` +
      `${Math.round(toolbarRowSingleLineCeiling)}px`,
  )

  step('assert the read-only find bar is hidden by default in the lockedByChanges shape')
  if ((await page.locator('.cfg-code-search').count()) !== 0) {
    throw new Error('.cfg-code-search is rendered before Ctrl+F is pressed (D1 wants it on-demand)')
  }

  step('press Ctrl+F and assert the find bar appears, focused, and ready to search (D-13)')
  // Clicking inside the read-only code area focuses `.cfg-code` (`tabIndex={0}`) - a descendant of
  // the `.cfg-code-panel` whose `onKeyDown` actually handles Ctrl+F/Escape - so the keydown this
  // sends bubbles up into that handler exactly like a real user's keystroke would.
  await lockedCodeView.click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Control+f')
  const searchBar = page.locator('.cfg-code-search')
  await searchBar.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const searchInput = searchBar.locator('input')
  // Bug 2 regression: a `requestAnimationFrame` guess at focus timing could leave
  // `document.activeElement` on `.cfg-code` (the container) instead of the input - visibly present
  // but not actually usable without a manual click. Compared by node identity (`el === activeElement`
  // inside the page), not by tag/class guessing, so this fails exactly when focus landed anywhere
  // other than the input itself.
  const inputFocusedOnFirstOpen = await searchInput.evaluate((el) => el === document.activeElement)
  if (!inputFocusedOnFirstOpen) {
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '(none)')
    const activeClass = await page.evaluate(() => document.activeElement?.className ?? '')
    throw new Error(
      `Ctrl+F opened the find bar but did not focus its input - document.activeElement is ` +
        `<${activeTag} class="${activeClass}"> instead (D-13 regression: focus-on-open raced ` +
        `React's commit)`,
    )
  }

  step('type a query and assert it actually produces live matches, not just a visible bar')
  // `q2l` is the launcher's own metadata tag (`[q2l v=... id=...]`, `render.ts`), emitted on every
  // rendered config file's header line unconditionally - unlike `unbindall`, it does not depend on
  // which way the D-15 toggle above just flipped, so this match is guaranteed regardless of
  // fixture content.
  await page.keyboard.type('q2l')
  const highlightCount = await lockedCodeView.locator('.cfg-match').count()
  if (highlightCount === 0) {
    throw new Error(
      'typing a query into the focused find bar produced no .cfg-match highlights - the bar is ' +
        'visible and focused but search itself is not live (would pass with a focused-but-inert input)',
    )
  }

  step('press Escape and assert the find bar disappears and focus is restored to the panel')
  await page.keyboard.press('Escape')
  await searchBar.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  // Bug 1 regression: Escape used to unmount the bar (and its focused input) without moving focus
  // anywhere, dropping it to `document.body`. Since Ctrl+F is handled by a container-scoped
  // `onKeyDown`, a keydown that never bubbles from a focused descendant of `.cfg-code-panel` would
  // never reach that handler again - checked directly here (not just inferred from the second
  // Ctrl+F below) so a failure points straight at the missing focus-restoration, not the reopen step.
  const activeAfterEscapeClass = await page.evaluate(() => document.activeElement?.className ?? '')
  if (!activeAfterEscapeClass.includes('cfg-code-panel')) {
    throw new Error(
      `Escape closed the find bar but left focus on <class="${activeAfterEscapeClass}"> instead of ` +
        `.cfg-code-panel - a subsequent Ctrl+F has no focused descendant to bubble a keydown from ` +
        `(D-13 regression: Bug 1)`,
    )
  }

  step('press Ctrl+F a second time and assert the bar reappears, focused (D-13 regression test)')
  await page.keyboard.press('Control+f')
  await searchBar.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const inputFocusedOnSecondOpen = await searchInput.evaluate((el) => el === document.activeElement)
  if (!inputFocusedOnSecondOpen) {
    throw new Error(
      'a second Ctrl+F after Escape did not reopen the find bar with focus in its input - this is ' +
        'the exact regression a focus guess plus no Escape focus-restoration silently passed before',
    )
  }

  step(
    'click into .cfg-code to move focus off the input without closing the bar, then press Ctrl+F ' +
      'again (already-open regression)',
  )
  // The bar is still open and focused in its input from the previous step. Clicking the code area
  // moves focus onto `.cfg-code` (`tabIndex={0}`) without pressing Escape, so the bar stays
  // mounted - exactly the "already open" state the regression needs: `setIsFindOpen(true)` is then
  // a no-op state update (React bails out because the value did not change), so the
  // `isFindOpen`-keyed focus effect never re-runs on its own. Before the fix, this left focus
  // stranded on `.cfg-code` and Ctrl+F did nothing observable.
  await lockedCodeView.click({ timeout: TIMEOUT_MS })
  const focusedOnCfgCodeAfterClick = await lockedCodeView.evaluate((el) => el === document.activeElement)
  if (!focusedOnCfgCodeAfterClick) {
    throw new Error(
      'clicking .cfg-code did not move focus onto it - cannot exercise the already-open regression',
    )
  }
  await page.keyboard.press('Control+f')
  const inputFocusedWhenAlreadyOpen = await searchInput.evaluate((el) => el === document.activeElement)
  if (!inputFocusedWhenAlreadyOpen) {
    throw new Error(
      'Ctrl+F while the find bar was already open (focus moved to .cfg-code) did not refocus the ' +
        'input - this is the already-open no-op regression: setIsFindOpen(true) is a no-op when ' +
        'already true, so the isFindOpen-keyed focus effect never re-runs on its own',
    )
  }
  console.log('a second Ctrl+F while the bar was already open (focus on .cfg-code) refocused the input')

  step('press Escape again to leave the find bar closed before restoring the fixture')
  await page.keyboard.press('Escape')
  await searchBar.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  console.log(
    'read-only find bar: hidden by default, opens focused on Ctrl+F, search is live, closes on ' +
      'Escape with focus restored to the panel, and reopens focused after a second Ctrl+F',
  )

  step('restore the fixture: discard the writeUnbindall change (D-15)')
  await page.getByTestId('config-discard').click({ timeout: TIMEOUT_MS })
  await page
    .getByRole('button', { name: 'Discard changes' })
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

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
  // that wrapped to two rows on every tab would still pass that. Story 061's own text is "height <=
  // one control row"; the back button is the one control guaranteed to render inside the header on
  // every tab, so its own rendered height is the non-magic-number yardstick - a single-row header
  // should be at most about 2x that tall, which a genuinely-wrapped two-row header would blow past.
  //
  // Read this as "one header ROW", not "one line of text": as of story 069 D3 the header holds a
  // deliberately *two-line* identity zone (name + unsaved indicator, then created/updated) while
  // still being one row - back button, identity zone and action cluster side by side, on one
  // flex line, the zone's second line living inside the middle child. So this ceiling is not the
  // assertion that forbids what 069 built; the number it guards is the header's overall height
  // (36px, driven by the 36px identity zone) against 2x the 28px back button = 56px, and what it
  // still catches is the failure story 061 cared about: the header's own `flex-wrap` breaking the
  // three zones onto two rows, which would put it at ~64px+. What forbids a *third* line, or a
  // second identity block, are the exactly-two-element-children and exactly-one-zone assertions
  // further down, not this one.
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

  // --- AC1 (story 069 D3): the identity zone renders two lines ------------------------------------
  // Two element children, the name on the first, created/updated on the second, and the second's top
  // edge at or below the first's bottom edge - which is what separates "two lines" from "one line
  // with more things on it". A side-by-side layout would put the two tops at the same y, an
  // everything-in-one-row layout would fail the child count or leave Created/Updated on row 1.
  step('assert the identity zone renders two lines')
  const identity = await readIdentityZone(page)

  if (identity.childCount !== 2) {
    throw new Error(
      `expected config-profile-identity to have exactly 2 element children (line 1 = name + ` +
        `unsaved indicator, line 2 = created/updated), found ${identity.childCount}: ` +
        `${JSON.stringify(identity.rows.map((row) => row.text))}`,
    )
  }

  const [line1, line2] = identity.rows
  if (!line1.hasH2 || !line1.text.toLowerCase().includes('plain profile')) {
    throw new Error(
      `line 1 of the identity zone does not carry the profile name h2 - got ` +
        `${JSON.stringify(line1.text)} (hasH2=${line1.hasH2})`,
    )
  }
  const line1Lower = line1.text.toLowerCase()
  if (line1Lower.includes('created') || line1Lower.includes('updated')) {
    throw new Error(
      `line 1 of the identity zone still carries the created/updated context AC1 puts on line 2 - ` +
        `got ${JSON.stringify(line1.text)}`,
    )
  }
  const line2Lower = line2.text.toLowerCase()
  if (!line2Lower.includes('created') || !line2Lower.includes('updated')) {
    throw new Error(
      `line 2 of the identity zone does not carry both Created and Updated - got ` +
        `${JSON.stringify(line2.text)}`,
    )
  }
  if (!(line1.rect.height > 0) || !(line2.rect.height > 0)) {
    throw new Error(
      `an identity line has no height - line1=${JSON.stringify(line1.rect)} ` +
        `line2=${JSON.stringify(line2.rect)}`,
    )
  }
  // 0.5px of tolerance for subpixel layout only - a zone that laid the two lines out side by side
  // would miss this by the full height of line 1, not by half a pixel.
  if (line2.rect.top < line1.rect.bottom - 0.5) {
    throw new Error(
      `identity line 2's top edge (${line2.rect.top}) is above line 1's bottom edge ` +
        `(${line1.rect.bottom}) - AC1 wants line 2 below line 1, not beside it`,
    )
  }
  console.log(
    `identity zone renders 2 lines: line 1 h=${Math.round(line1.rect.height)}px, line 2 ` +
      `h=${Math.round(line2.rect.height)}px, zone h=${Math.round(identity.rect.height)}px`,
  )

  // --- AC2 (story 069 D3): line 2 is subordinate, line 1 stays the most prominent text ------------
  // Both halves are computed, never hardcoded: "smaller" compares resolved `font-size`s, "dimmer"
  // compares each colour's WCAG relative luminance *distance to the surface the header sits on* -
  // a colour closer to the background than the name's is, by definition, the quieter of the two on
  // that background, whichever direction the theme runs in. And the name is only "the most prominent
  // text in the header" if nothing else in the header renders larger, so every text-bearing element
  // in the header is checked against it, not just the two on line 2.
  step('assert line 2 is subordinate to line 1')
  if (!identity.h2 || !(identity.h2.fontSize > 0) || identity.h2.luminance === null) {
    throw new Error(
      `could not read the profile name h2's computed type/colour - got ${JSON.stringify(identity.h2)}`,
    )
  }
  if (identity.backgroundLuminance === null) {
    throw new Error(
      `could not resolve the surface behind the header to compare luminance against - got ` +
        `${JSON.stringify(identity.background)}`,
    )
  }
  if (line2.textElements.length === 0) {
    throw new Error('found no text-bearing element on identity line 2 to compare against the h2')
  }

  const nameDistance = Math.abs(identity.h2.luminance - identity.backgroundLuminance)
  for (const element of line2.textElements) {
    if (!(element.fontSize < identity.h2.fontSize)) {
      throw new Error(
        `identity line 2's ${element.tag} ${JSON.stringify(element.text)} renders at ` +
          `${element.fontSize}px, not smaller than the profile name's ${identity.h2.fontSize}px (AC2)`,
      )
    }
    if (element.luminance === null) {
      throw new Error(
        `could not parse the colour of identity line 2's ${element.tag} ` +
          `${JSON.stringify(element.text)} - got ${element.color}`,
      )
    }
    const distance = Math.abs(element.luminance - identity.backgroundLuminance)
    if (!(distance < nameDistance)) {
      throw new Error(
        `identity line 2's ${element.tag} ${JSON.stringify(element.text)} (${element.color}) is ` +
          `not dimmer than the profile name (${identity.h2.color}) against the header's surface ` +
          `(${identity.background}): luminance distance ${distance.toFixed(4)} vs the name's ` +
          `${nameDistance.toFixed(4)} (AC2)`,
      )
    }
  }

  for (const element of identity.headerTextElements) {
    if (element.fontSize > identity.h2.fontSize) {
      throw new Error(
        `header text ${JSON.stringify(element.text)} renders at ${element.fontSize}px, larger than ` +
          `the profile name's ${identity.h2.fontSize}px - AC2 wants the name to stay the most ` +
          `prominent text in the header`,
      )
    }
  }
  console.log(
    `identity line 2 (${line2.textElements.length} text elements) is smaller and dimmer than the ` +
      `${identity.h2.fontSize}px name, which is the largest of the header's ` +
      `${identity.headerTextElements.length} text elements`,
  )

  // --- AC3 (story 069 D3): back left, actions right, both still centred ---------------------------
  // The identity zone is now taller than either of them, so "vertically centred" stops being free:
  // `items-start` on the header, or a `self-*` on one of the two, would leave one of these two
  // centre-y values sitting near the top of the header instead of at its middle.
  step('assert back and actions stay on the edges, vertically centred')
  const edges = await readHeaderEdges(page, 'Back to profiles')
  const back = edges.children.find((child) => child.isBack)
  const actionsZone = edges.children.find((child) => child.isActions)
  if (!back || !actionsZone) {
    throw new Error(
      `could not find the back button and/or config-profile-actions among the header's direct ` +
        `children - got ${JSON.stringify(edges.children.map((child) => child.label))}`,
    )
  }

  const leftmost = edges.children.reduce((a, b) => (b.x < a.x ? b : a))
  const rightmost = edges.children.reduce((a, b) => (b.right > a.right ? b : a))
  if (!leftmost.isBack) {
    throw new Error(
      `the leftmost header child is ${JSON.stringify(leftmost.label)} (x=${leftmost.x}), not the ` +
        `back button (x=${back.x}) - AC3 keeps back on the header's left edge`,
    )
  }
  if (!rightmost.isActions) {
    throw new Error(
      `the rightmost header child is ${JSON.stringify(rightmost.label)} ` +
        `(right=${rightmost.right}), not config-profile-actions (right=${actionsZone.right}) - ` +
        `AC3 keeps the action cluster on the header's right edge`,
    )
  }

  for (const child of [back, actionsZone]) {
    const offset = Math.abs(child.centerY - edges.centerY)
    if (offset > 1) {
      throw new Error(
        `${JSON.stringify(child.label)} is ${offset.toFixed(2)}px off the header's centre-y ` +
          `(${edges.centerY} vs ${child.centerY}) - AC3 wants it centred against the taller ` +
          `two-line identity zone`,
      )
    }
  }
  console.log(
    `back button and config-profile-actions are the leftmost/rightmost header children and both ` +
      `sit within 1px of the header's centre-y`,
  )

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

  // AC1 again, in the state the criterion actually names: "line 1 = profile name + unsaved/saved
  // indicator". The indicator only exists while the profile is dirty, so this is the only place it
  // can be checked - and it has to be checked, because an indicator appended to the zone itself
  // rather than to line 1 would render as a third line, which is both the wrong reading of AC1 and
  // another editor line spent (AC4). The `yh` `assertZoneStable` below then proves it costs no
  // height either.
  const indicatorPlacement = await page.getByTestId('config-profile-identity').evaluate((zone) => {
    const node = zone.querySelector('[data-testid="config-unsaved-indicator"]')
    const line1 = zone.children[0]
    return {
      found: node !== null,
      inLine1: node !== null && line1 !== undefined && line1.contains(node),
      childCount: zone.children.length,
    }
  })
  if (!indicatorPlacement.found || !indicatorPlacement.inLine1) {
    throw new Error(
      `config-unsaved-indicator is not on line 1 of the identity zone - ` +
        `${JSON.stringify(indicatorPlacement)} (AC1 puts the name and the indicator on line 1)`,
    )
  }
  if (indicatorPlacement.childCount !== 2) {
    throw new Error(
      `the identity zone has ${indicatorPlacement.childCount} element children while unsaved, ` +
        `expected 2 - the unsaved indicator must join line 1, not add a line of its own (AC1)`,
    )
  }
  console.log('the unsaved indicator renders on identity line 1, next to the name, adding no row')

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

  // AC5 (story 069 D3): "the identity zone wraps rather than pushing the action cluster off the
  // row". The `scrollWidth`/`clientWidth` check above proves the header itself does not overflow;
  // this proves the now-taller zone is *inside* it rather than spilling out of it (an absolutely
  // positioned or negatively-margined zone could satisfy the overflow check while hanging out of
  // the header), that it is still two lines under width pressure - a zone that gave up and
  // collapsed back to one line at 940px would not be the header AC1 asks for - and that the action
  // cluster is still on screen and hit-testable, checked below with every other header control.
  const identitySmall = await readIdentityZone(page)
  const containment = await page.getByTestId('config-profile-header').evaluate((header) => {
    const zone = header.querySelector('[data-testid="config-profile-identity"]')
    const h = header.getBoundingClientRect()
    const z = zone.getBoundingClientRect()
    return {
      header: { left: h.left, right: h.right, top: h.top, bottom: h.bottom },
      zone: { left: z.left, right: z.right, top: z.top, bottom: z.bottom, width: z.width },
    }
  })
  if (
    containment.zone.left < containment.header.left - 0.5 ||
    containment.zone.right > containment.header.right + 0.5 ||
    containment.zone.top < containment.header.top - 0.5 ||
    containment.zone.bottom > containment.header.bottom + 0.5 ||
    !(containment.zone.width > 0)
  ) {
    throw new Error(
      `config-profile-identity is not contained inside config-profile-header at 940x620 - ` +
        `${JSON.stringify(containment)}`,
    )
  }
  if (identitySmall.childCount !== 2) {
    throw new Error(
      `config-profile-identity renders ${identitySmall.childCount} lines at 940x620, expected the ` +
        `same 2 as at 1280x800 (AC1/AC5)`,
    )
  }
  const [smallLine1, smallLine2] = identitySmall.rows
  if (smallLine2.rect.top < smallLine1.rect.bottom - 0.5) {
    throw new Error(
      `identity line 2 is no longer below line 1 at 940x620 - line1=${JSON.stringify(smallLine1.rect)} ` +
        `line2=${JSON.stringify(smallLine2.rect)}`,
    )
  }
  await assertHitTestable(page, actions, 'action cluster')

  console.log(
    `identity zone stays two lines inside the header at 940x620 ` +
      `(zone h=${Math.round(identitySmall.rect.height)}px) and the action cluster is still ` +
      `hit-testable`,
  )

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

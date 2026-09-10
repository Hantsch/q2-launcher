// Story 083 D6 acceptance flow: the home hero's geometry (AC1) and its interaction contract
// (AC3/AC4/AC5/AC9) driven against the real, running app - mirrors
// `scripts/flows/config-header-geometry.mjs`'s "measure real geometry and throw on violation"
// shape, plus real waits past the carousel's own 8s interval rather than a fake timer, since this
// drives the actual built app.
//
// Runs against the `populated` fixture (the flow's own default variant, `scripts/flow.mjs`), which
// story 083 D6 seeds with a fresh, two-slide feed cache (`scripts/lib/fixture.mjs`'s
// `writePopulatedFixture()` -> `writeNewsFeedCache()`) - the same fixture the `home-hero` registry
// screen uses, so this flow always finds the hero in its filled state with exactly two slides to
// dot/prev/next through.
//
// Selectors, not guesses - read `src/renderer/src/modules/home/NewsHero.tsx` before changing any of
// these:
//   home-hero          NewsHero.tsx - the hero's own <section>, aria-labelled "Community news"
//   home-hero-frame     NewsHero.tsx - a real slide's rendered frame (filled state)
//   .home-hero-counter  NewsHero.tsx - the "n / m" position text (AC9)
//   "Previous news slide" / "Next news slide" / "Show news slide N" / "Pause the news rotation" /
//   "Resume the news rotation" - NewsHero.tsx's own translated `aria-label`s, no testid on any of
//   them (mirrors the rest of this file's convention of selecting by accessible name where no
//   testid exists, e.g. `config-controls-message`'s category-chip clicks in `screens.mjs`)
//
// The installation rail (`src/renderer/src/components/shell/InstallationRail.tsx`) has no testid
// either - it is the app's only `<aside>`, so `page.locator('aside').first()` is unambiguous.
import { resize } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors `NewsHero.tsx`'s `SLIDE_INTERVAL_MS` (story 083, Decisions: 8 seconds). A real wait, not
 * a fake timer - this flow drives the actual built app, which owns a real `setInterval`. */
const SLIDE_INTERVAL_MS = 8_000
/** Slack on top of the interval so a slow CI tick can never look like "did not advance". */
const WAIT_BUFFER_MS = 2_000
const ADVANCE_WAIT_MS = SLIDE_INTERVAL_MS + WAIT_BUFFER_MS

/** Story 083's Decisions/geometry: the hero is exactly 320px tall (`h-80 shrink-0`, `NewsHero.tsx`). */
const HERO_HEIGHT_PX = 320

const DEFAULT_VIEWPORT = { width: 1280, height: 800 }
/** Mirrors `scripts/lib/screens.mjs`'s `VIEWPORT_MIN`. */
const SMALL_VIEWPORT = { width: 940, height: 620 }

/** A point safely outside the hero (inside the title bar, above the rail/hero row) - used to move
 * the mouse away from the hero after a `.hover()`/click left it there, so a later "does it still
 * advance" check is not accidentally re-hovering it. */
const AWAY_FROM_HERO = { x: 4, y: 4 }

/** Reads the "n / m" position text (`home-hero-counter`, AC9 - the position as text, not only a
 * coloured dot). No testid on the element; `.home-hero-counter` is the one class NewsHero.tsx gives
 * it. */
async function readCounter(page) {
  const text = (await page.locator('.home-hero-counter').innerText()).trim()
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!match) {
    throw new Error(`could not parse the hero's "n / m" counter text - got ${JSON.stringify(text)}`)
  }
  return { position: Number(match[1]), total: Number(match[2]) }
}

/** The hero's own box, the installation rail's box and the current viewport - everything AC1's
 * geometry assertion needs, read together so the three numbers describe the same paint. */
async function measureHeroLayout(page) {
  const heroBox = await page.getByTestId('home-hero').boundingBox()
  const railBox = await page.locator('aside').first().boundingBox()
  // `page.viewportSize()` is always `null` here - a BrowserWindow ignores
  // `page.setViewportSize()` (see `scripts/lib/harness.mjs`'s `resize()`), so the window's real
  // content size has to be read out of the page itself instead.
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  if (!heroBox || !railBox || !viewport) {
    throw new Error(
      `could not measure hero/rail geometry - hero=${JSON.stringify(heroBox)} ` +
        `rail=${JSON.stringify(railBox)} viewport=${JSON.stringify(viewport)}`,
    )
  }
  return { heroBox, railBox, viewport }
}

/** AC1: exactly 320px tall, and spanning from the installation rail's right edge to the window's
 * right edge - at whatever viewport `label` names. 1px of tolerance for subpixel layout only. */
function assertHeroGeometry({ heroBox, railBox, viewport }, label) {
  if (Math.round(heroBox.height) !== HERO_HEIGHT_PX) {
    throw new Error(
      `${label}: the hero is ${Math.round(heroBox.height)}px tall, expected exactly ` +
        `${HERO_HEIGHT_PX}px (AC1)`,
    )
  }
  const railRight = railBox.x + railBox.width
  if (Math.abs(heroBox.x - railRight) > 1) {
    throw new Error(
      `${label}: the hero's left edge (${heroBox.x}) does not meet the installation rail's right ` +
        `edge (${railRight}) (AC1 - "spans between the rail and the window edge")`,
    )
  }
  const heroRight = heroBox.x + heroBox.width
  if (Math.abs(heroRight - viewport.width) > 1) {
    throw new Error(
      `${label}: the hero's right edge (${heroRight}) does not reach the window's right edge ` +
        `(${viewport.width}) (AC1)`,
    )
  }
}

/** AC9: every control gets the app's one global `:focus-visible` ring
 * (`outline: 2px solid var(--color-flame-500)`, `src/renderer/src/styles/index.css`) once reached by
 * keyboard - never asserted right after a mouse `.click()`, which deliberately does not trigger
 * `:focus-visible` (that is the whole point of the pseudo-class), only after a real `Tab` press. */
async function assertKeyboardFocusVisible(locator, label) {
  const info = await locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      isActive: el === document.activeElement,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    }
  })
  if (!info.isActive) {
    throw new Error(
      `${label} is not the focused element after Tab - every hero control must be keyboard ` +
        `reachable (AC9)`,
    )
  }
  if (info.outlineStyle === 'none' || info.outlineWidth === '0px') {
    throw new Error(
      `${label} has no visible focus ring when reached by keyboard (outline: ` +
        `${info.outlineStyle} ${info.outlineWidth}) (AC9)`,
    )
  }
}

export default async function homeHeroCarousel({ page, app, shot, step }) {
  step('open home and wait for the filled hero')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('home-hero-frame').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert the hero is 320px tall and spans rail-to-window-edge at 1280x800 (AC1)')
  assertHeroGeometry(await measureHeroLayout(page), '1280x800')
  await shot('hero-default-viewport')

  step('resize to 940x620 and assert the same geometry (AC1)')
  await resize(app, SMALL_VIEWPORT)
  assertHeroGeometry(await measureHeroLayout(page), '940x620')
  await shot('hero-small-viewport')

  step('resize back to 1280x800')
  await resize(app, DEFAULT_VIEWPORT)

  step('assert the carousel auto-advances on its own after the interval (AC3)')
  const beforeAutoAdvance = await readCounter(page)
  await page.waitForTimeout(ADVANCE_WAIT_MS)
  const afterAutoAdvance = await readCounter(page)
  if (afterAutoAdvance.position === beforeAutoAdvance.position) {
    throw new Error(
      `the hero did not auto-advance after waiting ${ADVANCE_WAIT_MS}ms - still on slide ` +
        `${beforeAutoAdvance.position}/${beforeAutoAdvance.total} (AC3)`,
    )
  }
  console.log(
    `auto-advanced from slide ${beforeAutoAdvance.position} to ${afterAutoAdvance.position} ` +
      `after ${ADVANCE_WAIT_MS}ms`,
  )

  step('assert hovering the hero pauses rotation (AC4)')
  await page.getByTestId('home-hero').hover()
  const beforeHoverWait = await readCounter(page)
  await page.waitForTimeout(ADVANCE_WAIT_MS)
  const afterHoverWait = await readCounter(page)
  if (afterHoverWait.position !== beforeHoverWait.position) {
    throw new Error(
      `the hero kept advancing while hovered: slide ${beforeHoverWait.position} -> ` +
        `${afterHoverWait.position} (AC4 - hover must pause rotation)`,
    )
  }
  // Move the mouse off the hero so the next real wait (auto-advance, reduced motion) is not
  // accidentally hovering it too.
  await page.mouse.move(AWAY_FROM_HERO.x, AWAY_FROM_HERO.y)

  step('assert dots, previous and next each change the slide (AC3/AC9)')
  const start = await readCounter(page)
  await page.getByRole('button', { name: 'Next news slide' }).click({ timeout: TIMEOUT_MS })
  const afterNext = await readCounter(page)
  if (afterNext.position === start.position) {
    throw new Error(`clicking "Next news slide" did not change the slide (AC3) - stayed on ${start.position}`)
  }
  await page.getByRole('button', { name: 'Previous news slide' }).click({ timeout: TIMEOUT_MS })
  const afterPrev = await readCounter(page)
  if (afterPrev.position !== start.position) {
    throw new Error(
      `clicking "Previous news slide" did not return to the starting slide (AC3) - expected ` +
        `${start.position}, got ${afterPrev.position}`,
    )
  }
  await page.getByRole('button', { name: 'Show news slide 2' }).click({ timeout: TIMEOUT_MS })
  const afterDot2 = await readCounter(page)
  if (afterDot2.position !== 2) {
    throw new Error(`clicking the second dot did not select slide 2 (AC3/AC9) - got ${afterDot2.position}`)
  }
  await page.getByRole('button', { name: 'Show news slide 1' }).click({ timeout: TIMEOUT_MS })
  const afterDot1 = await readCounter(page)
  if (afterDot1.position !== 1) {
    throw new Error(`clicking the first dot did not select slide 1 (AC3/AC9) - got ${afterDot1.position}`)
  }
  console.log('dots, previous and next each changed the slide as expected')
  await page.mouse.move(AWAY_FROM_HERO.x, AWAY_FROM_HERO.y)

  step('assert the pause control latches until pressed again (AC4)')
  const pauseButton = page.getByRole('button', { name: 'Pause the news rotation' })
  await pauseButton.click({ timeout: TIMEOUT_MS })
  const resumeButton = page.getByRole('button', { name: 'Resume the news rotation' })
  await resumeButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await resumeButton.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('the pause control did not report aria-pressed="true" once latched (AC4)')
  }
  await page.mouse.move(AWAY_FROM_HERO.x, AWAY_FROM_HERO.y)
  const beforeLatchWait = await readCounter(page)
  await page.waitForTimeout(ADVANCE_WAIT_MS)
  const afterLatchWait = await readCounter(page)
  if (afterLatchWait.position !== beforeLatchWait.position) {
    throw new Error(
      `the hero kept advancing after the pause control was latched, even with the pointer away ` +
        `from the hero (AC4)`,
    )
  }
  // Un-latch, restoring the hero to its normal rotating state before the reduced-motion check below.
  await resumeButton.click({ timeout: TIMEOUT_MS })
  await pauseButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  console.log('the pause control latches until pressed again, and stays paused with no pointer over it')

  step('assert reduced motion stops auto-advance but dots/previous/next still work (AC5)')
  // `settings:patch` resolves to the plain, patched `LauncherSettings` (`src/shared/ipc.ts`), not an
  // `Outcome<T>` - unlike `module:invoke`'s handlers, so this checks the field it just set rather
  // than an `.ok` envelope that does not exist here.
  const patchedSettings = await page.evaluate(() =>
    window.q2.invoke('settings:patch', { motion: 'reduced' }),
  )
  if (patchedSettings?.motion !== 'reduced') {
    throw new Error(`settings:patch({ motion: 'reduced' }) did not apply: ${JSON.stringify(patchedSettings)}`)
  }
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'reduced', undefined, {
    timeout: TIMEOUT_MS,
  })
  await page.mouse.move(AWAY_FROM_HERO.x, AWAY_FROM_HERO.y)
  const beforeReducedWait = await readCounter(page)
  await page.waitForTimeout(ADVANCE_WAIT_MS)
  const afterReducedWait = await readCounter(page)
  if (afterReducedWait.position !== beforeReducedWait.position) {
    throw new Error(
      `the hero auto-advanced under data-motion="reduced" (slide ${beforeReducedWait.position} -> ` +
        `${afterReducedWait.position}) - AC5 requires no auto-rotation under reduced motion`,
    )
  }
  await page.getByRole('button', { name: 'Next news slide' }).click({ timeout: TIMEOUT_MS })
  const afterReducedNext = await readCounter(page)
  if (afterReducedNext.position === beforeReducedWait.position) {
    throw new Error(
      '"Next news slide" did not change the slide under reduced motion (AC5 - dots/previous/next ' +
        'must still work)',
    )
  }
  console.log('no auto-advance under reduced motion; the next control still changes the slide')

  // Restore full motion before this flow ends - `ui:flow` never reseeds the fixture, so a stray
  // `motion: 'reduced'` would otherwise leak into whatever runs against this fixture next.
  const restoredSettings = await page.evaluate(() =>
    window.q2.invoke('settings:patch', { motion: 'system' }),
  )
  if (restoredSettings?.motion !== 'system') {
    throw new Error(
      `settings:patch({ motion: 'system' }) did not restore the fixture: ` +
        `${JSON.stringify(restoredSettings)}`,
    )
  }

  await shot('hero-interactions-done')

  step('assert every hero control is keyboard reachable with a visible focus ring (AC9)')
  // Establishes a known tab-order starting point via a real mouse click - no focus-ring assertion
  // here, since a mouse-focused element deliberately does not match `:focus-visible`. Everything
  // AFTER this click is reached with a real `Tab` key press instead, which does.
  const prevButton = page.getByRole('button', { name: 'Previous news slide' })
  await prevButton.click({ timeout: TIMEOUT_MS })

  const tabOrder = [
    { locator: page.getByRole('button', { name: 'Show news slide 1' }), label: 'dot 1' },
    { locator: page.getByRole('button', { name: 'Show news slide 2' }), label: 'dot 2' },
    { locator: page.getByRole('button', { name: 'Next news slide' }), label: 'the next-slide button' },
    {
      locator: page.getByRole('button', { name: /^(Pause|Resume) the news rotation$/ }),
      label: 'the pause/resume button',
    },
  ]
  for (const { locator, label } of tabOrder) {
    await page.keyboard.press('Tab')
    await assertKeyboardFocusVisible(locator, label)
  }
  console.log(
    `all ${tabOrder.length + 1} hero controls (previous, ${tabOrder.map((entry) => entry.label).join(', ')}) ` +
      'are keyboard reachable in order, each with a visible focus ring',
  )

  await shot('hero-keyboard-focus')
}

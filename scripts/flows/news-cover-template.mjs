// Story 095 D3: the acceptance surface for AC1 (the `cover` template's image is right-anchored and
// loses area on its left as the hero narrows) and AC2 (its title, body and buttons keep 4.5:1 over
// that image at every width from `WINDOW_MIN_WIDTH` upwards, with the contrast carried by the
// launcher's own scrim).
//
// Runs against the `news-cover` fixture variant, which it names itself (`export const variant`
// below, honoured by `scripts/flow.mjs`) - so `npm run ui:flow -- news-cover-template` is enough.
// Like every flow it never reseeds: run `npm run ui:seed` once after changing `scripts/lib/
// fixture.mjs`. That variant seeds exactly one `cover` slide (no dots, no interval, nothing that
// can rotate out from under a screenshot) plus a generated 2560x640 PNG in which no pixel is darker
// than `COVER_PROBE_MIN_CHANNEL`/255 - the whole point of AC2 is that the proof must not be able to
// pass because the contributed image happened to be dark.
//
// Two things this file is deliberately paranoid about, because getting either wrong would make it
// pass while proving nothing:
//
//  1. **The geometry is derived, not assumed.** `object-fit`/`object-position` are read back from
//     the live element and the run fails if they are not `cover` / `100% 50%`, because every
//     visible-source-rectangle formula below is only true for exactly that pair.
//  2. **The screenshot is proven fresh.** Each viewport is captured twice - once with the text
//     visible, once with it hidden - and the two captures must actually differ inside the title's
//     box. A stale or wrongly-clipped capture cannot satisfy that, so it cannot silently turn into
//     "no bright pixels found, therefore green".
//
// Selectors come from `src/renderer/src/modules/home/components/SlideCover.tsx` and
// `src/renderer/src/styles/home-hero.css`; read those before changing any of them.
import sharp from 'sharp'
import {
  COVER_PROBE_IMAGE_HEIGHT,
  COVER_PROBE_IMAGE_WIDTH,
  COVER_PROBE_MIN_CHANNEL,
  NEWS_COVER_SLIDE_TITLE,
} from '../lib/fixture.mjs'
import { resize } from '../lib/harness.mjs'

/** The only fixture variant this flow can say anything about - see the header. */
export const variant = 'news-cover'

const TIMEOUT_MS = 8_000

/** `WINDOW_MIN_WIDTH` (940, `src/shared/constants.ts`) is AC2's floor; 1280 is the app's default
 * width; 1920 is a normal wide desktop. Heights mirror `scripts/lib/screens.mjs`'s own pairs - the
 * hero is a fixed height regardless, so only the widths carry meaning here. */
const VIEWPORTS = [
  { width: 940, height: 620 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]

/** WCAG AA for body text - AC2's own number. */
const MIN_CONTRAST_RATIO = 4.5

/**
 * The lightest pixel that may still show through where the scrim has faded out, as a 0-255 channel
 * floor. This is the check that makes AC2 honest: if the scrim covered the whole slide, or if the
 * fixture image were dark, the text could pass 4.5:1 without the template being usable at all. The
 * probe image is at least `COVER_PROBE_MIN_CHANNEL` everywhere, so anything below this floor means
 * the image is not actually reaching the screen.
 */
const MIN_VISIBLE_IMAGE_CHANNEL = 200

/** Fraction of the slide's width, at its right edge, sampled for the check above. */
const IMAGE_SHOWS_THROUGH_STRIP = 0.02

/** `.home-hero-frame-enter` runs for `--dur-base` (200ms) on mount; a resize triggers no animation,
 * but layout/`object-fit` still needs a frame to settle before anything is measured. */
const SETTLE_MS = 400

/** Every text-bearing element of a `cover` slide, in document order. */
const TEXT_SELECTOR =
  '.home-hero-slide-cover :is(.home-hero-title, .home-hero-body, .home-hero-buttons button)'

/** A point outside the hero, so no `:hover` style is in effect while a viewport is measured. */
const AWAY_FROM_HERO = { x: 4, y: 4 }

// --- colour maths (WCAG 2.x relative luminance / contrast ratio) --------------------------------

function channelLuminance(value) {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(r, g, b) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

function contrastRatio(luminanceA, luminanceB) {
  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)
  return (lighter + 0.05) / (darker + 0.05)
}

/** `getComputedStyle().color` - `rgb(r, g, b)` or `rgba(r, g, b, a)`. A translucent text colour
 * would make "the text colour" a composite this flow does not compute, so it is refused loudly
 * rather than approximated. */
function parseCssColor(value, label) {
  const numbers = String(value).match(/-?\d*\.?\d+/g)
  if (!numbers || numbers.length < 3) {
    throw new Error(`could not parse the computed colour of ${label}: ${JSON.stringify(value)}`)
  }
  const [r, g, b, a] = numbers.map(Number)
  if (a !== undefined && a !== 1) {
    throw new Error(
      `${label} has a translucent text colour (${value}) - this probe compares against an opaque ` +
        'colour and would report a ratio the user never sees',
    )
  }
  return { r, g, b }
}

// --- pixel sampling ----------------------------------------------------------------------------

/** A CSS-pixel rect mapped into the screenshot's own pixel grid, clamped to the image. Rounded
 * outwards on purpose: sampling one pixel too much is conservative, one pixel too few would let a
 * bright edge of the box escape the measurement. */
function toPixelRegion(rect, scale, imageWidth, imageHeight) {
  const left = Math.max(0, Math.min(imageWidth - 1, Math.floor(rect.x * scale)))
  const top = Math.max(0, Math.min(imageHeight - 1, Math.floor(rect.y * scale)))
  const right = Math.max(left + 1, Math.min(imageWidth, Math.ceil((rect.x + rect.width) * scale)))
  const bottom = Math.max(top + 1, Math.min(imageHeight, Math.ceil((rect.y + rect.height) * scale)))
  return { left, top, width: right - left, height: bottom - top }
}

/** The lightest pixel in `region` (by relative luminance - the worst case for the light text this
 * app puts on top of it) plus the region's mean channel value, which is only used as the
 * "this capture really did change" witness. */
async function sampleRegion(png, region) {
  const { data, info } = await sharp(png)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true })
  let lightest = null
  let lightestLuminance = -1
  let total = 0
  let pixels = 0
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luminance = relativeLuminance(r, g, b)
    if (luminance > lightestLuminance) {
      lightestLuminance = luminance
      lightest = { r, g, b }
    }
    total += r + g + b
    pixels += 1
  }
  if (!lightest) throw new Error(`sampled an empty region: ${JSON.stringify(region)}`)
  return { lightest, luminance: lightestLuminance, mean: total / (pixels * 3) }
}

// --- geometry ----------------------------------------------------------------------------------

/**
 * Reads the live `<img>`/slide boxes, the image's intrinsic size and the two computed properties
 * every formula in `visibleSourceRect()` depends on.
 */
async function measureCover(page) {
  const measured = await page.evaluate(() => {
    const image = document.querySelector('.home-hero-cover-image')
    const slide = document.querySelector('.home-hero-slide-cover')
    if (!image || !slide) {
      return {
        error: `no cover slide on screen (img: ${Boolean(image)}, slide: ${Boolean(slide)})`,
      }
    }
    const imageRect = image.getBoundingClientRect()
    const slideRect = slide.getBoundingClientRect()
    const style = getComputedStyle(image)
    const box = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      image: {
        ...box(imageRect),
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        complete: image.complete,
        objectFit: style.objectFit,
        objectPosition: style.objectPosition,
      },
      slide: box(slideRect),
    }
  })
  if (measured.error) throw new Error(measured.error)

  const { image, slide } = measured
  if (!image.complete || image.naturalWidth === 0) {
    throw new Error(
      `the cover image never decoded (complete=${image.complete}, naturalWidth=${image.naturalWidth}) - ` +
        'the q2launcher://app/news-image/... cache hit did not serve bytes',
    )
  }
  if (
    image.naturalWidth !== COVER_PROBE_IMAGE_WIDTH ||
    image.naturalHeight !== COVER_PROBE_IMAGE_HEIGHT
  ) {
    throw new Error(
      `the cover image is ${image.naturalWidth}x${image.naturalHeight}, expected the fixture's ` +
        `${COVER_PROBE_IMAGE_WIDTH}x${COVER_PROBE_IMAGE_HEIGHT} probe - this flow is measuring the wrong element`,
    )
  }
  if (image.objectFit !== 'cover') {
    throw new Error(
      `the cover image renders with object-fit: ${image.objectFit} - every visible-rectangle ` +
        "formula below assumes `cover`",
    )
  }
  // `object-position` is deliberately NOT asserted to equal '100% 50%' here: AC1's right-anchoring
  // claim has to be proven by measurement, not assumed by an early guard. `visibleSourceRect()`
  // below reads the live computed `object-position` and derives the visible rectangle from it, so
  // if this value ever drifts (e.g. to `50% 50%`), the AC1 assertion at the bottom of this file -
  // "the visible part of the source ends at the image's own right edge" - fails for real instead of
  // being unreachable dead code.
  // The image is `position: absolute; inset: 0` inside the slide, so the two boxes must coincide;
  // if they ever stop doing so, "the image fills the whole slide behind the text" (AC1) is gone.
  if (Math.abs(image.width - slide.width) > 1 || Math.abs(image.height - slide.height) > 1) {
    throw new Error(
      `the cover image (${image.width}x${image.height}) does not fill its slide ` +
        `(${slide.width}x${slide.height}) (AC1 - "fills the whole slide behind the text")`,
    )
  }
  return measured
}

/**
 * Parses a computed `object-position` (e.g. `"100% 50%"`) into `{ x, y }` fractions in `[0, 1]`,
 * where `1` means "align to the right/bottom" and `0.5` means centred. Browsers normalise this
 * computed style to a pair of percentages, so only that shape is supported here - anything else
 * (a keyword, a `px` value) is refused loudly rather than silently mis-measured.
 */
function parseObjectPosition(value) {
  const parts = String(value).trim().split(/\s+/)
  if (parts.length !== 2 || !parts.every((part) => /^-?\d+(\.\d+)?%$/.test(part))) {
    throw new Error(
      `expected a computed object-position of two percentages (e.g. "100% 50%"), got ${JSON.stringify(value)}`,
    )
  }
  const [x, y] = parts.map((part) => Number.parseFloat(part) / 100)
  return { x, y }
}

/**
 * Which part of the *source* image is on screen, in source pixels, for `object-fit: cover`: scale
 * to cover, then distribute the cropped-away overflow between the two edges according to the
 * live, measured `object-position` - NOT assumed to be right-anchored. This is what makes AC1's
 * "the visible rectangle's right edge equals the image's right edge" assertion a real check: if
 * `object-position` ever drifted away from `100% 50%`, `xFraction` here would move off `1`, the
 * computed `right` would move off `naturalWidth`, and that assertion would fail for real.
 */
function visibleSourceRect({ width, height, naturalWidth, naturalHeight, objectPosition }) {
  const { x: xFraction, y: yFraction } = parseObjectPosition(objectPosition)
  const scale = Math.max(width / naturalWidth, height / naturalHeight)
  const visibleWidth = Math.min(naturalWidth, width / scale)
  const visibleHeight = Math.min(naturalHeight, height / scale)
  const overflowX = naturalWidth - visibleWidth
  const overflowY = naturalHeight - visibleHeight
  const left = overflowX * xFraction
  const top = overflowY * yFraction
  return {
    scale,
    left,
    right: left + visibleWidth,
    top,
    bottom: top + visibleHeight,
    widthFraction: visibleWidth / naturalWidth,
    heightFraction: visibleHeight / naturalHeight,
  }
}

/** The slide width at which the source stops being cropped horizontally and starts being cropped
 * vertically: where `width / naturalWidth === height / naturalHeight`. */
function crossoverSlideWidth({ height, naturalWidth, naturalHeight }) {
  return (naturalWidth * height) / naturalHeight
}

// --- AC2's probe -------------------------------------------------------------------------------

/**
 * Hides only the glyphs (`color: transparent`, via CSSOM - a `style` attribute write would trip the
 * app's own `style-src 'self'` CSP), leaving each element's own background in place. That is the
 * honest background for a slide button, which paints `bg-raised` under its label; for the title and
 * body, which paint nothing of their own, it is the scrim over the image - exactly what AC2 is
 * about.
 */
async function probeTextContrast(page, label) {
  const targets = await page.$$eval(TEXT_SELECTOR, (elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const edge = (property) => Number.parseFloat(style.getPropertyValue(property)) || 0
      // The element's *content* box, not its border box: the only region a glyph of this element
      // can ever be painted in. Identical to the border box for the title and the body, which have
      // neither padding nor border; for a slide button it excludes the padding and the rounded
      // corners, where the background behind the button shows through but no text ever lands.
      const left = edge('border-left-width') + edge('padding-left')
      const right = edge('border-right-width') + edge('padding-right')
      const top = edge('border-top-width') + edge('padding-top')
      const bottom = edge('border-bottom-width') + edge('padding-bottom')
      const name = element.classList.contains('home-hero-title')
        ? 'title'
        : element.classList.contains('home-hero-body')
          ? 'body'
          : `button "${(element.textContent ?? '').trim()}"`
      return {
        name,
        rect: {
          x: rect.x + left,
          y: rect.y + top,
          width: Math.max(1, rect.width - left - right),
          height: Math.max(1, rect.height - top - bottom),
        },
        color: style.color,
      }
    }),
  )
  if (targets.length < 3) {
    throw new Error(
      `${label}: expected a title, a body and at least one button on the cover slide, found ` +
        `${targets.length} text element(s) - the fixture or the template changed`,
    )
  }

  const before = await page.screenshot()

  await page.$$eval(TEXT_SELECTOR, (elements) => {
    for (const element of elements) {
      element.style.color = 'transparent'
      element.style.textShadow = 'none'
    }
  })
  const after = await page.screenshot()
  await page.$$eval(TEXT_SELECTOR, (elements) => {
    for (const element of elements) {
      element.style.color = ''
      element.style.textShadow = ''
    }
  })

  const meta = await sharp(after).metadata()
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  const scale = meta.width / viewportWidth
  const results = []

  for (const target of targets) {
    const region = toPixelRegion(target.rect, scale, meta.width, meta.height)
    const hidden = await sampleRegion(after, region)
    const shown = await sampleRegion(before, region)
    // The freshness guard: hiding the glyphs has to have changed the pixels inside this very box.
    // If it did not, the capture is stale or the box is not where the text is, and every number
    // below would be meaningless.
    if (Math.abs(hidden.mean - shown.mean) < 0.1) {
      throw new Error(
        `${label}: hiding the ${target.name} changed nothing inside its own box ` +
          `(mean ${shown.mean.toFixed(3)} -> ${hidden.mean.toFixed(3)}) - the screenshot is stale ` +
          'or the sampled box is not the one the text is painted in',
      )
    }
    const { r, g, b } = parseCssColor(target.color, `${label}'s ${target.name}`)
    const ratio = contrastRatio(relativeLuminance(r, g, b), hidden.luminance)
    results.push({ ...target, ratio, background: hidden.lightest, region })
  }

  return results
}

/** Proves the image is genuinely on screen where the scrim has faded, i.e. that the contrast
 * measured above came from the scrim rather than from a covered-up or dark image. */
async function assertImageShowsThrough(page, image, label) {
  const png = await page.screenshot()
  const meta = await sharp(png).metadata()
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  const scale = meta.width / viewportWidth
  const stripWidth = image.width * IMAGE_SHOWS_THROUGH_STRIP
  const region = toPixelRegion(
    { x: image.x + image.width - stripWidth, y: image.y, width: stripWidth, height: image.height },
    scale,
    meta.width,
    meta.height,
  )
  const { lightest } = await sampleRegion(png, region)
  const darkestChannel = Math.min(lightest.r, lightest.g, lightest.b)
  if (darkestChannel < MIN_VISIBLE_IMAGE_CHANNEL) {
    throw new Error(
      `${label}: the brightest pixel in the rightmost ${(IMAGE_SHOWS_THROUGH_STRIP * 100).toFixed(0)}% of ` +
        `the slide is rgb(${lightest.r}, ${lightest.g}, ${lightest.b}), below the ` +
        `${MIN_VISIBLE_IMAGE_CHANNEL}/255 floor - the near-white probe image is not actually ` +
        'reaching the screen, so any contrast measured over it proves nothing (AC2)',
    )
  }
  return lightest
}

// --- the flow ----------------------------------------------------------------------------------

export default async function newsCoverTemplate({ page, app, shot, step, variant: runVariant }) {
  if (runVariant !== variant) {
    throw new Error(
      `this flow only means anything against the '${variant}' fixture variant (got ` +
        `'${runVariant}') - run \`npm run ui:seed\` once, then \`npm run ui:flow -- news-cover-template\``,
    )
  }

  step('open home and wait for the cover slide')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('home-hero-frame').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .locator('.home-hero-slide-cover .home-hero-title', { hasText: NEWS_COVER_SLIDE_TITLE })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () => {
      const image = document.querySelector('.home-hero-cover-image')
      return Boolean(image?.complete) && (image?.naturalWidth ?? 0) > 0
    },
    undefined,
    { timeout: TIMEOUT_MS },
  )
  await page.mouse.move(AWAY_FROM_HERO.x, AWAY_FROM_HERO.y)

  const measurements = []
  const contrastFailures = []

  for (const viewport of VIEWPORTS) {
    const label = `${viewport.width}x${viewport.height}`
    step(`measure the cover slide at ${label} (AC1 + AC2)`)
    await resize(app, viewport)
    await page.waitForTimeout(SETTLE_MS)

    const { image, slide, viewport: real } = await measureCover(page)
    if (Math.abs(real.width - viewport.width) > 2) {
      throw new Error(
        `asked for a ${viewport.width}px-wide window but the app reports ${real.width}px - this ` +
          'display clamped the window, so the measurement would not be the one it claims to be',
      )
    }

    const visible = visibleSourceRect(image)
    const crossover = crossoverSlideWidth(image)
    const brightest = await assertImageShowsThrough(page, image, label)
    const contrast = await probeTextContrast(page, label)

    for (const entry of contrast) {
      if (entry.ratio < MIN_CONTRAST_RATIO) {
        contrastFailures.push(
          `${label}: the ${entry.name} reaches only ${entry.ratio.toFixed(2)}:1 against the ` +
            `lightest pixel behind it (rgb(${entry.background.r}, ${entry.background.g}, ` +
            `${entry.background.b}), text ${entry.color}) - AC2 needs ${MIN_CONTRAST_RATIO}:1`,
        )
      }
    }
    console.log(
      `  ${label}: slide ${slide.width.toFixed(0)}x${slide.height.toFixed(0)}, ` +
        `visible source x ${visible.left.toFixed(0)}..${visible.right.toFixed(0)} ` +
        `(${(visible.widthFraction * 100).toFixed(1)}% of width), y ${visible.top.toFixed(0)}..` +
        `${visible.bottom.toFixed(0)} (${(visible.heightFraction * 100).toFixed(1)}% of height); ` +
        `brightest image pixel rgb(${brightest.r}, ${brightest.g}, ${brightest.b}); ` +
        contrast.map((entry) => `${entry.name} ${entry.ratio.toFixed(2)}:1`).join(', '),
    )

    measurements.push({ viewport, real, image, slide, visible, crossover })
    await shot(`cover-${viewport.width}`)
  }

  step("assert the image stays anchored to the slide's right edge (AC1)")
  for (const entry of measurements) {
    if (Math.abs(entry.visible.right - entry.image.naturalWidth) > 0.5) {
      throw new Error(
        `${entry.viewport.width}px: the visible part of the source ends at x=` +
          `${entry.visible.right.toFixed(1)} instead of the image's own right edge ` +
          `(${entry.image.naturalWidth}) - the cover image is not right-anchored (AC1)`,
      )
    }
  }

  step('assert the image crops from the left as the hero narrows (AC1)')
  // Widest first, so "narrower" means "later in this list".
  const byWidth = [...measurements].sort((a, b) => b.slide.width - a.slide.width)
  for (let i = 1; i < byWidth.length; i += 1) {
    const wider = byWidth[i - 1]
    const narrower = byWidth[i]
    if (narrower.visible.left < wider.visible.left - 0.5) {
      throw new Error(
        `narrowing the slide from ${wider.slide.width.toFixed(0)}px to ` +
          `${narrower.slide.width.toFixed(0)}px moved the visible source's left edge from ` +
          `${wider.visible.left.toFixed(1)} to ${narrower.visible.left.toFixed(1)} - it must never ` +
          'move left, the image loses area on its left as the hero narrows (AC1)',
      )
    }
    if (
      narrower.slide.width < narrower.crossover &&
      narrower.visible.left <= wider.visible.left + 0.5
    ) {
      throw new Error(
        `${narrower.slide.width.toFixed(0)}px is below the crossover width ` +
          `(${narrower.crossover.toFixed(0)}px), so the source must be cropped MORE on its left ` +
          `than at ${wider.slide.width.toFixed(0)}px - got ${narrower.visible.left.toFixed(1)} vs ` +
          `${wider.visible.left.toFixed(1)} (AC1)`,
      )
    }
  }
  const belowCrossover = measurements.filter((entry) => entry.slide.width < entry.crossover)
  if (belowCrossover.length === 0) {
    throw new Error(
      'not one of the tested widths is below the crossover width, so nothing here actually ' +
        "exercised AC1's left-cropping half",
    )
  }

  step('report the contrast findings (AC2)')
  if (contrastFailures.length > 0) {
    throw new Error(
      `${contrastFailures.length} text element(s) fall below ${MIN_CONTRAST_RATIO}:1 over the ` +
        `near-white probe image:\n    ${contrastFailures.join('\n    ')}`,
    )
  }

  step('log the measured geometry for the kit documentation (D4/D6)')
  // Grep-able, one fact per line: D4/D6 copy these numbers into the content repository's template
  // READMEs instead of re-deriving them from CSS.
  const reference = measurements[0]
  const safeLeft = Math.max(...measurements.map((entry) => entry.visible.left))
  const safeTop = Math.max(...measurements.map((entry) => entry.visible.top))
  const safeBottom = Math.min(...measurements.map((entry) => entry.visible.bottom))
  const widths = measurements.map((entry) => entry.viewport.width).sort((a, b) => a - b)
  const windowOffset = reference.real.width - reference.slide.width

  console.log(`COVER_SOURCE_PX=${reference.image.naturalWidth}x${reference.image.naturalHeight}`)
  console.log(`COVER_SLIDE_HEIGHT_PX=${reference.slide.height.toFixed(0)}`)
  console.log(`CROSSOVER_SLIDE_WIDTH_PX=${reference.crossover.toFixed(0)}`)
  console.log(`CROSSOVER_WINDOW_WIDTH_PX=${(reference.crossover + windowOffset).toFixed(0)}`)
  console.log(`SAFE_ZONE_WINDOW_RANGE_PX=${widths[0]}..${widths[widths.length - 1]}`)
  console.log(
    `SAFE_ZONE_RIGHT_FRACTION=${((reference.image.naturalWidth - safeLeft) / reference.image.naturalWidth).toFixed(3)}`,
  )
  console.log(
    `SAFE_ZONE_MIDDLE_FRACTION=${((safeBottom - safeTop) / reference.image.naturalHeight).toFixed(3)}`,
  )
  console.log(
    `SAFE_ZONE_SOURCE_RECT_PX=${safeLeft.toFixed(0)},${safeTop.toFixed(0)} -> ${reference.image.naturalWidth},${safeBottom.toFixed(0)}`,
  )
  for (const entry of measurements) {
    console.log(
      `COVER_AT_${entry.viewport.width}=slide ${entry.slide.width.toFixed(0)}x` +
        `${entry.slide.height.toFixed(0)}; visible_source=` +
        `${entry.visible.left.toFixed(0)},${entry.visible.top.toFixed(0)} -> ` +
        `${entry.visible.right.toFixed(0)},${entry.visible.bottom.toFixed(0)}; ` +
        `width_fraction=${entry.visible.widthFraction.toFixed(3)}; ` +
        `height_fraction=${entry.visible.heightFraction.toFixed(3)}`,
    )
  }
  console.log(
    `PROBE_IMAGE_MIN_CHANNEL=${COVER_PROBE_MIN_CHANNEL} (no pixel of the fixture image is darker ` +
      'than this, so every ratio above was carried by the scrim)',
  )
}

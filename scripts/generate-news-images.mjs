// Generates the placeholder/example images the community news fixture content and template kit
// reference: the fixtures' wide banner and squarer split images
// (content/q2_community_content/news/*.md), plus one example.png per image template under
// content/q2_community_content/news/_templates/<template>/ (story 095 D6). All synthesized with
// sharp (no external asset, no licensing question) — mirrors
// generate-installation-icons.mjs's sharp-usage/repo-root-resolution convention.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const newsDir = join(repoRoot, 'content', 'q2_community_content', 'news')
const outDir = join(newsDir, 'img')
const templatesDir = join(newsDir, '_templates')

mkdirSync(outDir, { recursive: true })

const images = [
  {
    file: join(outDir, 'banner-repository.png'),
    logLabel: join('content/q2_community_content/news/img', 'banner-repository.png'),
    width: 1600,
    height: 480,
    background: { r: 32, g: 54, b: 74, alpha: 1 },
    overlay: { r: 92, g: 156, b: 194, alpha: 1 },
  },
  {
    file: join(outDir, 'split-bootstrap.png'),
    logLabel: join('content/q2_community_content/news/img', 'split-bootstrap.png'),
    width: 900,
    height: 900,
    background: { r: 46, g: 40, b: 64, alpha: 1 },
    overlay: { r: 166, g: 124, b: 214, alpha: 1 },
  },
]

for (const { file, logLabel, width, height, background, overlay } of images) {
  const stripeHeight = Math.round(height * 0.35)
  const stripeSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="${height - stripeHeight}" width="${width}" height="${stripeHeight}" ` +
      `fill="rgb(${overlay.r},${overlay.g},${overlay.b})" />` +
      `</svg>`,
  )
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .composite([{ input: stripeSvg }])
    .png()
    .toFile(file)
  console.log(`${logLabel}`)
}

// Story 095 D6: one synthetic example.png per image template (split, banner, cover), each at its
// own README's recommended source size, kept well under the 25 KB weight budget (mirrors
// split-bootstrap.png's ~17 KB) with the same flat-background-plus-stripe visual style as the
// fixture images above. `text` has no image field, so it gets no example.
const templateExamples = [
  {
    template: 'split',
    width: 900,
    height: 900,
    background: { r: 46, g: 40, b: 64, alpha: 1 },
    overlay: { r: 166, g: 124, b: 214, alpha: 1 },
  },
  {
    template: 'banner',
    width: 1600,
    height: 480,
    background: { r: 32, g: 54, b: 74, alpha: 1 },
    overlay: { r: 92, g: 156, b: 194, alpha: 1 },
  },
  {
    template: 'cover',
    width: 2560,
    height: 640,
    background: { r: 40, g: 32, b: 46, alpha: 1 },
    overlay: { r: 214, g: 140, b: 92, alpha: 1 },
    // `cover` is right-anchored: only the rightmost ~78% (measured fraction 0.775, per the
    // template's own README) survives at the narrowest supported window. Mark that boundary so a
    // contributor can see, at a glance, what is safe to put detail in.
    safeZoneFraction: 0.775,
  },
]

for (const { template, width, height, background, overlay, safeZoneFraction } of templateExamples) {
  const dir = join(templatesDir, template)
  mkdirSync(dir, { recursive: true })
  const outputPath = join(dir, 'example.png')
  const stripeHeight = Math.round(height * 0.35)

  let safeZoneMarkup = ''
  if (safeZoneFraction !== undefined) {
    const cropBoundaryX = Math.round(width * (1 - safeZoneFraction))
    safeZoneMarkup =
      // Shade the left "may be cropped away at narrow widths" margin...
      `<rect x="0" y="0" width="${cropBoundaryX}" height="${height}" fill="rgba(0,0,0,0.45)" />` +
      // ...and draw a dashed line at the safe-zone boundary itself.
      `<line x1="${cropBoundaryX}" y1="0" x2="${cropBoundaryX}" y2="${height}" ` +
      `stroke="white" stroke-width="6" stroke-dasharray="24,18" />`
  }

  const overlaySvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="${height - stripeHeight}" width="${width}" height="${stripeHeight}" ` +
      `fill="rgb(${overlay.r},${overlay.g},${overlay.b})" />` +
      safeZoneMarkup +
      `</svg>`,
  )
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .composite([{ input: overlaySvg }])
    .png({ compressionLevel: 9 })
    .toFile(outputPath)
  console.log(join('content/q2_community_content/news/_templates', template, 'example.png'))
}

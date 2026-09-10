// Generates the two placeholder images the community news fixture content
// references (content/q2_community_content/news/*.md): a wide banner image
// and a squarer split image, both synthesized with sharp (no external asset,
// no licensing question) — mirrors generate-installation-icons.mjs's
// sharp-usage/repo-root-resolution convention.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'content', 'q2_community_content', 'news', 'img')

mkdirSync(outDir, { recursive: true })

const images = [
  {
    file: 'banner-repository.png',
    width: 1600,
    height: 480,
    background: { r: 32, g: 54, b: 74, alpha: 1 },
    overlay: { r: 92, g: 156, b: 194, alpha: 1 },
  },
  {
    file: 'split-bootstrap.png',
    width: 900,
    height: 900,
    background: { r: 46, g: 40, b: 64, alpha: 1 },
    overlay: { r: 166, g: 124, b: 214, alpha: 1 },
  },
]

for (const { file, width, height, background, overlay } of images) {
  const outputPath = join(outDir, file)
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
    .toFile(outputPath)
  console.log(`${file} -> ${join('content/q2_community_content/news/img', file)}`)
}

// Generates the shipped installation-icon set: reads the authoring originals
// in assets/installations/*.png (repo root) and writes 128px square .avif
// files into src/renderer/src/assets/installations/, one per source file,
// same basename.
//
// The renderer never names these files literally — its manifest
// (src/renderer/src/lib/installation-icons.ts) discovers them with
// import.meta.glob. This script is the only place that reads the source
// directory by listing it; everything downstream is derived.
import { readdirSync, mkdirSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SIZE = 128
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(repoRoot, 'assets', 'installations')
const outDir = join(repoRoot, 'src', 'renderer', 'src', 'assets', 'installations')

mkdirSync(outDir, { recursive: true })

const sources = readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith('.png'))
if (sources.length === 0) {
  throw new Error(`no .png sources found in ${sourceDir}`)
}

for (const name of sources) {
  const { name: id } = parse(name)
  const inputPath = join(sourceDir, name)
  const outputPath = join(outDir, `${id}.avif`)
  await sharp(inputPath)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .avif({ quality: 80 })
    .toFile(outputPath)
  console.log(`${name} -> ${join('src/renderer/src/assets/installations', `${id}.avif`)}`)
}

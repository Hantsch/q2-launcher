// Generates the launcher's app icon: build/icon.png and build/icon.ico.
//
// The shape comes from the concept artwork in assets/ — a clipped graphite
// command window with an amber status rail, the classic Quake II horned
// crescent and an amber play control. The artwork is only used as a stencil:
// every pixel is classified into one of four regions (outside, panel, amber,
// green) and repainted with the launcher's own palette, so the executable, the
// desktop shortcut and the app chrome always share exact colours.
//
// Why a stencil instead of a plain resize: Windows shows this icon from 256px
// down to 16px. A straight box filter turns the crescent's thin horns into a
// faint smudge at taskbar size. Working per region lets small entries drop the
// margin and weight the mark's coverage up, so the silhouette survives.
import { deflateSync, inflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = 'assets/q2-launcher-icon-concept-04-command-window.png'
const PNG_SIZE = 256
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

/** Launcher palette (see src/renderer/src/styles/) — not the artwork's own. */
const PALETTE = {
  panel: [0x16, 0x18, 0x1d],
  amber: [0xff, 0x8a, 0x1f],
  green: [0x7d, 0x93, 0x69],
}

const OUTSIDE = 0
const PANEL = 1
const AMBER = 2
const GREEN = 3

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- PNG decode -----------------------------------------------------------

/** Minimal decoder for the one file we read: 8-bit truecolour, no interlace. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const depth = buffer[24]
  const colourType = buffer[25]
  const interlace = buffer[28]
  if (depth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colourType})`)
  }

  const channels = colourType === 6 ? 4 : 3
  const idat = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(height * stride)

  // Undo the per-scanline filters (PNG spec, 9.2).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const rowIn = y * (stride + 1) + 1
    const rowOut = y * stride
    for (let i = 0; i < stride; i++) {
      const value = raw[rowIn + i]
      const left = i >= channels ? pixels[rowOut + i - channels] : 0
      const up = y > 0 ? pixels[rowOut - stride + i] : 0
      const upLeft = i >= channels && y > 0 ? pixels[rowOut - stride + i - channels] : 0
      let restored
      switch (filter) {
        case 0:
          restored = value
          break
        case 1:
          restored = value + left
          break
        case 2:
          restored = value + up
          break
        case 3:
          restored = value + ((left + up) >> 1)
          break
        case 4: {
          const predictor = left + up - upLeft
          const dLeft = Math.abs(predictor - left)
          const dUp = Math.abs(predictor - up)
          const dUpLeft = Math.abs(predictor - upLeft)
          restored =
            value + (dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft)
          break
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`)
      }
      pixels[rowOut + i] = restored & 0xff
    }
  }

  return { width, height, channels, pixels }
}

// --- stencil --------------------------------------------------------------

/**
 * The concept render has the transparency checkerboard baked in as light grey
 * pixels, so "outside" is detected rather than read from an alpha channel.
 * Nothing in the artwork itself is both light and desaturated, which makes the
 * test unambiguous.
 */
function classify(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (min > 150 && max - min < 40) return OUTSIDE
  if (r > g + 40 && g > b + 20) return AMBER
  if (g > r + 4 && g > 60) return GREEN
  return PANEL
}

function buildStencil() {
  const { width, height, channels, pixels } = decodePng(readFileSync(join(repoRoot, SOURCE)))
  const classes = new Uint8Array(width * height)

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels
      const alpha = channels === 4 ? pixels[offset + 3] : 255
      const region =
        alpha < 128 ? OUTSIDE : classify(pixels[offset], pixels[offset + 1], pixels[offset + 2])
      classes[y * width + x] = region
      if (region === OUTSIDE) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) throw new Error('stencil is empty — colour classification failed')
  return { width, height, classes, bounds: { minX, minY, maxX, maxY } }
}

// --- render ---------------------------------------------------------------

/**
 * Coverage weight applied to the amber and green regions.
 *
 * At 16-32px the crescent's horns and the rail are thinner than one output
 * pixel; averaging alone leaves them washed into the panel. Weighting their
 * coverage keeps the mark readable without moving or rescaling any motif.
 */
function markWeight(size) {
  if (size <= 32) return 1.8
  if (size <= 48) return 1.4
  if (size <= 64) return 1.15
  return 1
}

/**
 * How far the crescent is grown, in output pixels, before downsampling.
 *
 * The horns are ~2% of the artwork's width. Below ~48px they are thinner than
 * the output grid, and weighting their coverage only tints the panel instead of
 * drawing a line. Growing the region first is the same move a designer makes by
 * hand when cutting small icon sizes: keep the silhouette, drop the hairlines.
 */
function markGrowth(size) {
  if (size <= 20) return 0.38
  if (size <= 32) return 0.3
  if (size <= 48) return 0.18
  return 0
}

/**
 * Grows the green region by `radius` source pixels using an integral image, so
 * the cost does not depend on the radius. Only panel pixels are overwritten:
 * the crescent must not eat into the status rail or the play control.
 */
function growMark(stencil, radius) {
  const { width, height, classes } = stencil
  if (radius < 1) return classes

  const stride = width + 1
  const sums = new Int32Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isGreen = classes[y * width + x] === GREEN ? 1 : 0
      sums[(y + 1) * stride + x + 1] =
        isGreen + sums[y * stride + x + 1] + sums[(y + 1) * stride + x] - sums[y * stride + x]
    }
  }

  const grown = Uint8Array.prototype.slice.call(classes)
  const r = Math.round(radius)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height - 1, y + r)
    for (let x = 0; x < width; x++) {
      if (classes[y * width + x] !== PANEL) continue
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width - 1, x + r)
      const total =
        sums[(y1 + 1) * stride + x1 + 1] -
        sums[y0 * stride + x1 + 1] -
        sums[(y1 + 1) * stride + x0] +
        sums[y0 * stride + x0]
      if (total > 0) grown[y * width + x] = GREEN
    }
  }
  return grown
}

/** Share of the canvas the artwork spans. Compact entries lose the margin. */
function artworkSpan(size) {
  return size <= 48 ? 1 : 0.94
}

function render(stencil, size) {
  const { width, bounds } = stencil
  const artWidth = bounds.maxX - bounds.minX + 1
  const artHeight = bounds.maxY - bounds.minY + 1

  // Fit the artwork square into the canvas, centred, and keep its aspect ratio.
  const span = artworkSpan(size) * size
  const scale = span / Math.max(artWidth, artHeight)
  const classes = growMark(stencil, markGrowth(size) / scale)
  const drawWidth = artWidth * scale
  const drawHeight = artHeight * scale
  const originX = (size - drawWidth) / 2
  const originY = (size - drawHeight) / 2

  const weight = markWeight(size)
  const pixels = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Source rectangle covered by this output pixel, in stencil coordinates.
      const sx0 = bounds.minX + (x - originX) / scale
      const sx1 = bounds.minX + (x + 1 - originX) / scale
      const sy0 = bounds.minY + (y - originY) / scale
      const sy1 = bounds.minY + (y + 1 - originY) / scale

      const from = (value, limit) => Math.max(0, Math.min(limit, Math.floor(value)))
      const xStart = from(sx0, bounds.maxX)
      const xEnd = from(Math.ceil(sx1) - 1, bounds.maxX)
      const yStart = from(sy0, bounds.maxY)
      const yEnd = from(Math.ceil(sy1) - 1, bounds.maxY)

      const area = [0, 0, 0, 0]
      let total = 0
      for (let sy = yStart; sy <= yEnd; sy++) {
        const rowOverlap = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        if (rowOverlap <= 0) continue
        for (let sx = xStart; sx <= xEnd; sx++) {
          const columnOverlap = Math.min(sx + 1, sx1) - Math.max(sx, sx0)
          if (columnOverlap <= 0) continue
          const overlap = rowOverlap * columnOverlap
          area[classes[sy * width + sx]] += overlap
          total += overlap
        }
      }

      const offset = (y * size + x) * 4
      if (total === 0) continue

      const opaque = total - area[OUTSIDE]
      if (opaque <= 0) continue

      const amber = area[AMBER] * weight
      const green = area[GREEN] * weight
      const panel = area[PANEL]
      const mix = amber + green + panel
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(
          (PALETTE.panel[channel] * panel +
            PALETTE.amber[channel] * amber +
            PALETTE.green[channel] * green) /
            mix,
        )
      }
      pixels[offset + 3] = Math.round((opaque / total) * 255)
    }
  }

  return pixels
}

// --- PNG encode -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

function toPng(pixels, size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// --- ICO encode -----------------------------------------------------------

/** PNG-compressed entries are supported by Windows since Vista. */
function toIco(entries) {
  const directory = Buffer.alloc(6 + entries.length * 16)
  directory.writeUInt16LE(0, 0) // reserved
  directory.writeUInt16LE(1, 2) // type: icon
  directory.writeUInt16LE(entries.length, 4)

  let imageOffset = directory.length
  for (let i = 0; i < entries.length; i++) {
    const { size, png } = entries[i]
    const offset = 6 + i * 16
    directory[offset] = size === 256 ? 0 : size
    directory[offset + 1] = size === 256 ? 0 : size
    directory[offset + 2] = 0 // palette size
    directory[offset + 3] = 0 // reserved
    directory.writeUInt16LE(1, offset + 4) // colour planes
    directory.writeUInt16LE(32, offset + 6) // bits per pixel
    directory.writeUInt32LE(png.length, offset + 8)
    directory.writeUInt32LE(imageOffset, offset + 12)
    imageOffset += png.length
  }

  return Buffer.concat([directory, ...entries.map(({ png }) => png)])
}

// --- write ----------------------------------------------------------------

const buildDir = join(repoRoot, 'build')
mkdirSync(buildDir, { recursive: true })

const stencil = buildStencil()
const entries = ICO_SIZES.map((size) => ({ size, png: toPng(render(stencil, size), size) }))
const png = entries.find(({ size }) => size === PNG_SIZE).png
const ico = toIco(entries)

writeFileSync(join(buildDir, 'icon.png'), png)
writeFileSync(join(buildDir, 'icon.ico'), ico)

console.log(`source          ${SOURCE} (${stencil.width}x${stencil.height})`)
console.log(`build/icon.png  ${png.length} bytes (${PNG_SIZE}x${PNG_SIZE})`)
console.log(`build/icon.ico  ${ico.length} bytes (${ICO_SIZES.join(', ')} px)`)

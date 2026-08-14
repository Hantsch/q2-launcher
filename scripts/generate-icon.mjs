// Generates the launcher's app icon from code: build/icon.png and build/icon.ico.
//
// The rest of the UI ships zero binary art (see src/renderer/src/styles/surfaces.css),
// but electron-builder needs a real .ico for the Windows window icon, taskbar
// entry and installer. Generating it from a committed script keeps the icon in
// version control as source rather than as an opaque blob: change the constants
// below, re-run `npm run icon`, and the change is reviewable.
//
// Dependency-free on purpose - PNG is just zlib plus four chunks, and a
// single-image .ico is a 22-byte header in front of a PNG.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
/** Supersampling factor. Anti-aliasing by rendering big and averaging down. */
const SS = 4

const AMBER = [0xff, 0x8a, 0x1f]
const PLATE_TOP = [0x24, 0x27, 0x2d]
const PLATE_BOTTOM = [0x0a, 0x0b, 0x0d]

/** Octagon: a square intersected with a rotated square. */
function plateField(x, y, half, chamfer) {
  const square = Math.max(Math.abs(x), Math.abs(y)) - half
  const rotated = Math.abs(x) + Math.abs(y) - chamfer
  return Math.max(square, rotated)
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/** Renders one supersampled pixel; returns [r, g, b, a]. */
function sample(px, py) {
  const n = SIZE * SS
  // Centre-origin coordinates in the range roughly [-128, 128].
  const x = (px + 0.5) / SS - SIZE / 2
  const y = (py + 0.5) / SS - SIZE / 2

  const half = 112
  const chamfer = 176
  const outer = plateField(x, y, half, chamfer)

  if (outer > 0) return [0, 0, 0, 0]

  // Amber rim, 7px wide, hugging the outer edge.
  if (outer > -7) return [...AMBER, 255]

  // Inner bevel: a faint lighter line just inside the rim.
  const bevel = plateField(x, y, half - 14, chamfer - 22)
  const onBevel = bevel > -2 && bevel < 0

  // The "II": two vertical bars.
  const barHalfWidth = 15
  const barGap = 26
  const inBars =
    Math.abs(y) <= 74 &&
    (Math.abs(x - barGap) <= barHalfWidth || Math.abs(x + barGap) <= barHalfWidth)
  if (inBars) return [...AMBER, 255]

  // Plate body: lit from the top-left, so the gradient runs along x + y.
  const t = Math.min(1, Math.max(0, (x + y + 180) / 360))
  const body = mix(PLATE_TOP, PLATE_BOTTOM, t)
  if (onBevel) return [...mix(body, [0x6a, 0x70, 0x7a], 0.55), 255]
  return [...body, 255]
}

/** Renders at SIZE*SS then box-filters down to SIZE, which is the anti-aliasing. */
function render() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4)

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb, sa] = sample(x * SS + sx, y * SS + sy)
          // Premultiply so transparent samples do not darken the edges.
          const w = sa / 255
          r += sr * w
          g += sg * w
          b += sb * w
          a += sa
        }
      }
      const count = SS * SS
      const alpha = a / count
      const weight = alpha === 0 ? 0 : count * (alpha / 255)
      const offset = (y * SIZE + x) * 4
      pixels[offset] = weight === 0 ? 0 : Math.round(r / weight)
      pixels[offset + 1] = weight === 0 ? 0 : Math.round(g / weight)
      pixels[offset + 2] = weight === 0 ? 0 : Math.round(b / weight)
      pixels[offset + 3] = Math.round(alpha)
    }
  }

  return pixels
}

// --- PNG ------------------------------------------------------------------

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

// --- ICO ------------------------------------------------------------------

/** Single 256x256 PNG-compressed entry, supported since Windows Vista. */
function toIco(png) {
  const directory = Buffer.alloc(6 + 16)
  directory.writeUInt16LE(0, 0) // reserved
  directory.writeUInt16LE(1, 2) // type: icon
  directory.writeUInt16LE(1, 4) // one image
  directory[6] = 0 // width 256 is encoded as 0
  directory[7] = 0 // height 256 is encoded as 0
  directory[8] = 0 // palette size
  directory[9] = 0 // reserved
  directory.writeUInt16LE(1, 10) // colour planes
  directory.writeUInt16LE(32, 12) // bits per pixel
  directory.writeUInt32LE(png.length, 14)
  directory.writeUInt32LE(directory.length, 18) // offset of the image data
  return Buffer.concat([directory, png])
}

// --- write ----------------------------------------------------------------

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(buildDir, { recursive: true })

const png = toPng(render(), SIZE)
writeFileSync(join(buildDir, 'icon.png'), png)
writeFileSync(join(buildDir, 'icon.ico'), toIco(png))

console.log(`build/icon.png  ${png.length} bytes`)
console.log(`build/icon.ico  ${toIco(png).length} bytes`)

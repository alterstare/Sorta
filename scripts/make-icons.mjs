// App icons from the logo (`sorta icon.png`, 1024², square — corners are rounded here):
//   build/icon.png      1024² with rounded corners (same shape as the top-bar logo)
//   build/icon.ico      16–256 px for Windows (exe, window title bar, taskbar)
//   build/icons/N.png   the same sizes as PNG (Linux window / desktop icons)
// Every size is rendered on its own from the full-size art (area-averaged), so
// the halftone dots blend into tone instead of the blotches Windows makes when
// it shrinks one big image itself.
//   node scripts/make-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'sorta icon.png'
const SIZE = 1024
const RADIUS = 0.22 // corner radius / side (≈ the top bar's 8px on 28px... softened for big sizes)
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512]
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

const mask = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${SIZE * RADIUS}" ry="${SIZE * RADIUS}" fill="#fff"/></svg>`
)
const rounded = await sharp(readFileSync(join(root, SOURCE)))
  .resize(SIZE, SIZE)
  .ensureAlpha()
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer()
mkdirSync(join(root, 'build/icons'), { recursive: true })
writeFileSync(join(root, 'build/icon.png'), rounded)
writeFileSync(join(root, 'src/renderer/src/assets/logo.png'), await sharp(rounded).resize(128, 128, { kernel: 'mitchell' }).png().toBuffer())

// Downscale in linear light with premultiplied alpha (sharp does both), then a
// touch of sharpening on the tiny sizes so the "S" stays crisp.
const render = async (n) => {
  let img = sharp(rounded).resize(n, n, { kernel: n <= 64 ? 'lanczos3' : 'mitchell' })
  // Tiny sizes: the fine purple stripes average out to a pale lavender, so
  // lift saturation and contrast a little to keep the shape readable.
  if (n <= 32) img = sharp(await img.png().toBuffer()).modulate({ saturation: 1.6 }).linear(1.2, -20)
  if (n <= 48) img = img.sharpen({ sigma: 0.5 })
  return img.png({ compressionLevel: 9 }).toBuffer()
}
const pngs = new Map()
for (const n of SIZES) {
  const b = await render(n)
  pngs.set(n, b)
  writeFileSync(join(root, `build/icons/${n}x${n}.png`), b)
}

// ICO container with PNG-compressed entries.
const imgs = ICO_SIZES.map((n) => pngs.get(n))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(ICO_SIZES.length, 4)
const dir = Buffer.alloc(16 * ICO_SIZES.length)
let offset = 6 + dir.length
ICO_SIZES.forEach((n, i) => {
  const e = i * 16
  dir.writeUInt8(n >= 256 ? 0 : n, e)
  dir.writeUInt8(n >= 256 ? 0 : n, e + 1)
  dir.writeUInt16LE(1, e + 4)
  dir.writeUInt16LE(32, e + 6)
  dir.writeUInt32LE(imgs[i].length, e + 8)
  dir.writeUInt32LE(offset, e + 12)
  offset += imgs[i].length
})
writeFileSync(join(root, 'build/icon.ico'), Buffer.concat([header, dir, ...imgs]))
console.log('icons:', SIZES.join(', '))

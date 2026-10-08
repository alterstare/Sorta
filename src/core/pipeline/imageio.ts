// Image decoding via sharp (libvips). Only reads the source file — never
// writes to it. gif / animated webp use their first frame.
import sharp from 'sharp'
import type { RgbImage } from '../ml/types'

const open = (path: string): sharp.Sharp => sharp(path, { pages: 1, failOn: 'none', limitInputPixels: 0 })

export async function probe(path: string): Promise<{ width: number; height: number }> {
  const m = await open(path).metadata()
  // EXIF orientations 5–8 swap the displayed width/height.
  const swap = (m.orientation ?? 1) >= 5
  return { width: (swap ? m.height : m.width) ?? 0, height: (swap ? m.width : m.height) ?? 0 }
}

export async function writeThumb(path: string, out: string, size = 320): Promise<void> {
  await open(path)
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(out)
}

// 32×32 grayscale for pHash.
export async function gray32(path: string): Promise<Uint8Array> {
  const buf = await open(path).rotate().resize(32, 32, { fit: 'fill' }).grayscale().raw().toBuffer()
  return new Uint8Array(buf.buffer, buf.byteOffset, 32 * 32)
}

// RGB pixels for the models, transparency flattened onto white, longest side
// capped so huge images don't blow up memory (models resize further anyway).
export async function loadRgb(path: string, maxSide = 1024): Promise<RgbImage> {
  const { data, info } = await open(path)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) }
}

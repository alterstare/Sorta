// Deterministic fake models for tests (CLAUDE.md §9: no real models, no real
// images in tests). Results are keyed by a simple fingerprint of the pixels so
// a test can script "this dummy image is character X".
import type { Box, Detector, Embedder, RgbImage, TagResult, Tagger } from './types'

// Fingerprint = average RGB, as "r,g,b" — solid-color dummy images map 1:1.
export function colorKey(img: RgbImage): string {
  let r = 0
  let g = 0
  let b = 0
  const n = img.width * img.height
  for (let i = 0; i < n; i++) {
    r += img.data[i * 3]
    g += img.data[i * 3 + 1]
    b += img.data[i * 3 + 2]
  }
  return `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`
}

export function solidImage(width: number, height: number, rgb: [number, number, number]): RgbImage {
  const data = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) data.set(rgb, i * 3)
  return { width, height, data }
}

const EMPTY_TAGS: TagResult = {
  rating: { general: 1, sensitive: 0, questionable: 0, explicit: 0 },
  characters: [],
  general: []
}

export class MockTagger implements Tagger {
  readonly name = 'mock-tagger'
  constructor(private script: Record<string, TagResult> = {}) {}
  async tag(img: RgbImage): Promise<TagResult> {
    return this.script[colorKey(img)] ?? EMPTY_TAGS
  }
}

export class MockDetector implements Detector {
  readonly name = 'mock-detector'
  constructor(private script: Record<string, { faces?: Box[]; people?: Box[] }> = {}) {}
  async faces(img: RgbImage): Promise<Box[]> {
    return this.script[colorKey(img)]?.faces ?? []
  }
  async people(img: RgbImage): Promise<Box[]> {
    return this.script[colorKey(img)]?.people ?? []
  }
}

// Embeds an image as a fixed vector per color (unknown colors → hashed vector),
// normalized, so cosine similarity behaves like the real thing.
export class MockEmbedder implements Embedder {
  readonly name = 'mock-embedder'
  constructor(
    readonly dim = 8,
    private script: Record<string, number[]> = {}
  ) {}
  async embed(img: RgbImage): Promise<Float32Array> {
    const key = colorKey(img)
    const v = new Float32Array(this.dim)
    const s = this.script[key]
    if (s) v.set(s.slice(0, this.dim))
    else for (let i = 0; i < this.dim; i++) v[i] = Math.sin((hash(key) + 1) * (i + 1))
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < v.length; i++) v[i] /= norm
    return v
  }
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

// Character-similarity embeddings (deepghs CCIP, OpenRAIL) and anime person
// detection (deepghs YOLOv8, MIT). CCIP's own "difference" is (1 − cos)/2 with
// a same-character threshold of 0.1785, i.e. cosine ≥ ~0.643.
import sharp from 'sharp'
import type * as Ort from 'onnxruntime-node'
import { gpuProvider } from './gpu'
import type { Box, Detector, Embedder, RgbImage } from './types'

export const CCIP_SAME_COS = 1 - 2 * 0.17847511429108218 // ≈ 0.643

let ortMod: typeof Ort | null = null
async function ort(): Promise<typeof Ort> {
  if (!ortMod) ortMod = (await import('onnxruntime-node')) as typeof Ort
  return ortMod
}

async function openSession(file: string, useGpu: boolean): Promise<Ort.InferenceSession> {
  const o = await ort()
  const gpu = useGpu ? gpuProvider() : null
  if (gpu) {
    try {
      return await o.InferenceSession.create(file, { executionProviders: [gpu, 'cpu'], graphOptimizationLevel: 'basic' })
    } catch {
      /* fall through */
    }
  }
  return o.InferenceSession.create(file, { executionProviders: ['cpu'] })
}

const raw = (img: RgbImage): sharp.Sharp =>
  sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 3 }
  })

// Cut a box out of an image (clamped), as a new RgbImage.
export async function crop(img: RgbImage, b: Box, pad = 0.06): Promise<RgbImage> {
  const px = b.w * pad
  const py = b.h * pad
  const left = Math.max(0, Math.floor(b.x - px))
  const top = Math.max(0, Math.floor(b.y - py))
  const width = Math.max(1, Math.min(img.width - left, Math.ceil(b.w + 2 * px)))
  const height = Math.max(1, Math.min(img.height - top, Math.ceil(b.h + 2 * py)))
  const { data, info } = await raw(img).extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s // both unit length
}

export class CcipEmbedder implements Embedder {
  readonly name = 'ccip-caformer-24-randaug-pruned'
  readonly dim = 768
  private constructor(private s: Ort.InferenceSession) {}

  static async load(file: string, useGpu: boolean): Promise<CcipEmbedder> {
    return new CcipEmbedder(await openSession(file, useGpu))
  }

  // 384×384 (stretched, as the reference implementation), mean/std 0.5.
  async embed(img: RgbImage): Promise<Float32Array> {
    const o = await ort()
    const S = 384
    const data = await raw(img).resize(S, S, { fit: 'fill', kernel: 'linear' }).raw().toBuffer()
    const plane = S * S
    const x = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) x[c * plane + i] = (data[i * 3 + c] / 255 - 0.5) / 0.5
    const out = await this.s.run({ [this.s.inputNames[0]]: new o.Tensor('float32', x, [1, 3, S, S]) })
    const v = Float32Array.from(out[this.s.outputNames[0]].data as Float32Array)
    let n = 0
    for (const t of v) n += t * t
    n = Math.sqrt(n) || 1
    for (let i = 0; i < v.length; i++) v[i] /= n
    return v
  }
}

export class PersonDetector implements Detector {
  readonly name = 'person_detect_v1.3_s'
  private constructor(
    private s: Ort.InferenceSession,
    private threshold: number
  ) {}

  static async load(file: string, useGpu: boolean, threshold = 0.324): Promise<PersonDetector> {
    return new PersonDetector(await openSession(file, useGpu), threshold)
  }

  async faces(): Promise<Box[]> {
    return [] // faces are not used: CCIP works on person crops
  }

  // YOLOv8: longest side scaled to 640, both sides rounded up to /32, 0..1.
  async people(img: RgbImage): Promise<Box[]> {
    const o = await ort()
    const scale = 640 / Math.max(img.width, img.height)
    const W = Math.max(32, Math.ceil((img.width * scale) / 32) * 32)
    const H = Math.max(32, Math.ceil((img.height * scale) / 32) * 32)
    const data = await raw(img).resize(W, H, { fit: 'fill' }).raw().toBuffer()
    const plane = W * H
    const x = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) x[c * plane + i] = data[i * 3 + c] / 255
    const out = await this.s.run({ [this.s.inputNames[0]]: new o.Tensor('float32', x, [1, 3, H, W]) })
    const t = out[this.s.outputNames[0]]
    const [, rows, n] = t.dims as number[] // [1, 5, anchors]
    const d = t.data as Float32Array
    const sx = img.width / W
    const sy = img.height / H
    const boxes: Box[] = []
    for (let i = 0; i < n; i++) {
      const score = d[4 * n + i]
      if (score < this.threshold || rows < 5) continue
      const cx = d[i]
      const cy = d[n + i]
      const w = d[2 * n + i]
      const h = d[3 * n + i]
      boxes.push({ x: (cx - w / 2) * sx, y: (cy - h / 2) * sy, w: w * sx, h: h * sy, score })
    }
    return nms(boxes, 0.7)
  }
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return inter / (a.w * a.h + b.w * b.h - inter || 1)
}

export function nms(boxes: Box[], thr: number): Box[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const keep: Box[] = []
  for (const b of sorted) if (keep.every((k) => iou(k, b) < thr)) keep.push(b)
  return keep
}

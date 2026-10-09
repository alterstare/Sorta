// Assist taggers: a second (and third) opinion on characters for images the
// main WD tagger couldn't settle. They only report characters; rating stays
// with WD. Pre-processing: pad to a white square, CHW float, per-model
// normalization (verified against the reference outputs).
import { promises as fs } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import type * as Ort from 'onnxruntime-node'
import { gpuProvider } from './gpu'
import type { RgbImage } from './types'
import { CAMIE_SPEC, PIXAI_SPEC } from './models'
import { csvRow } from './csv'

export interface CharScore {
  tag: string
  score: number
}

export interface AssistTagger {
  readonly id: 'pixai' | 'camie'
  knows(tag: string): boolean // is the character in this model's vocabulary
  characters(img: RgbImage): Promise<CharScore[]> // ≥ KEEP_MIN, best first
}

const KEEP_MIN = 0.1

let ortMod: typeof Ort | null = null
async function ort(): Promise<typeof Ort> {
  if (!ortMod) ortMod = (await import('onnxruntime-node')) as typeof Ort
  return ortMod
}

// DirectML when allowed; `basic` graph optimization because the default
// (`all`) fusions crash PixAI on DirectML. Falls back to CPU.
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

async function squareChw(img: RgbImage, size: number, mean: number[], std: number[]): Promise<Float32Array> {
  const { data, info } = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 3 }
  })
    .resize(size, size, { fit: 'contain', background: '#ffffff', kernel: 'cubic' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== size || info.height !== size) throw new Error(`assist input ${info.width}x${info.height}`)
  const plane = size * size
  const x = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) x[c * plane + i] = (data[i * 3 + c] / 255 - mean[c]) / std[c]
  return x
}

function top(scores: ArrayLike<number>, idx: number[], names: string[], transform = (v: number) => v): CharScore[] {
  const out: CharScore[] = []
  for (const i of idx) {
    const s = transform(scores[i])
    if (s >= KEEP_MIN) out.push({ tag: names[i], score: s })
  }
  return out.sort((a, b) => b.score - a.score)
}

export class PixaiTagger implements AssistTagger {
  readonly id = 'pixai' as const
  private constructor(
    private s: Ort.InferenceSession,
    private names: string[],
    private charIdx: number[],
    private vocab: Set<string>
  ) {}

  static async load(dir: string, useGpu: boolean): Promise<PixaiTagger> {
    const [onnx, csv] = PIXAI_SPEC.files.map((f) => join(dir, f.file))
    const rows = (await fs.readFile(csv, 'utf8')).split(/\r?\n/).slice(1).filter(Boolean).map(csvRow)
    const names = rows.map((r) => r[2])
    const charIdx = rows.flatMap((r, i) => (r[3] === '4' ? [i] : []))
    return new PixaiTagger(await openSession(onnx, useGpu), names, charIdx, new Set(charIdx.map((i) => names[i])))
  }

  knows(tag: string): boolean {
    return this.vocab.has(tag)
  }

  async characters(img: RgbImage): Promise<CharScore[]> {
    const o = await ort()
    const x = await squareChw(img, 448, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
    const out = await this.s.run({ [this.s.inputNames[0]]: new o.Tensor('float32', x, [1, 3, 448, 448]) })
    return top(out['prediction'].data as Float32Array, this.charIdx, this.names)
  }
}

export class CamieTagger implements AssistTagger {
  readonly id = 'camie' as const
  private constructor(
    private s: Ort.InferenceSession,
    private names: string[],
    private charIdx: number[],
    private vocab: Set<string>
  ) {}

  static async load(dir: string, useGpu: boolean): Promise<CamieTagger> {
    const [onnx, meta] = CAMIE_SPEC.files.map((f) => join(dir, f.file))
    const m = JSON.parse(await fs.readFile(meta, 'utf8')).dataset_info.tag_mapping as {
      idx_to_tag: Record<string, string>
      tag_to_category: Record<string, string>
    }
    const n = Object.keys(m.idx_to_tag).length
    const names = Array.from({ length: n }, (_, i) => m.idx_to_tag[String(i)])
    const charIdx = names.flatMap((t, i) => (m.tag_to_category[t] === 'character' ? [i] : []))
    return new CamieTagger(await openSession(onnx, useGpu), names, charIdx, new Set(charIdx.map((i) => names[i])))
  }

  knows(tag: string): boolean {
    return this.vocab.has(tag)
  }

  async characters(img: RgbImage): Promise<CharScore[]> {
    const o = await ort()
    const x = await squareChw(img, 512, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    const out = await this.s.run({ [this.s.inputNames[0]]: new o.Tensor('float32', x, [1, 3, 512, 512]) })
    return top(out['refined_predictions'].data as Float32Array, this.charIdx, this.names, (v) => 1 / (1 + Math.exp(-v)))
  }
}

// Character tag → game (series tag), from PixAI's tag list ("ips" column).
export async function loadSeriesMap(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const rows = (await fs.readFile(join(dir, 'pixai-tags.csv'), 'utf8')).split(/\r?\n/).slice(1).filter(Boolean).map(csvRow)
    for (const r of rows) {
      if (r[3] !== '4') continue
      try {
        const ips = JSON.parse(r[5] || '[]') as string[]
        if (ips[0]) map.set(r[2], ips[0])
      } catch {
        /* malformed row */
      }
    }
  } catch {
    /* not downloaded yet */
  }
  return map
}

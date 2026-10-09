// WD Tagger v3 (SmilingWolf) on onnxruntime-node. Input: 448×448 BGR float
// 0..255, NHWC, image padded to a white square. Output: sigmoid scores per
// tag in selected_tags.csv (category 9 = rating, 4 = character, 0 = general).
import { promises as fs } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import type * as Ort from 'onnxruntime-node'
import { gpuProvider } from './gpu'
import type { RgbImage, TagResult, Tagger } from './types'
import { TAGGER_SPEC } from './models'

const SIZE = 448
const CHAR_MIN = 0.1 // keep weaker character tags as candidates; the pipeline thresholds decide
const GENERAL_MIN = 0.35

interface TagRow {
  name: string
  category: number
}

let ortMod: typeof Ort | null = null
async function ort(): Promise<typeof Ort> {
  if (!ortMod) ortMod = (await import('onnxruntime-node')) as typeof Ort
  return ortMod
}

export class WdTagger implements Tagger {
  readonly name = TAGGER_SPEC.id
  private constructor(
    private session: Ort.InferenceSession,
    private tags: TagRow[],
    readonly provider: string
  ) {}

  static async load(modelsDir: string, useGpu: boolean): Promise<WdTagger> {
    const o = await ort()
    const [onnx, csv] = TAGGER_SPEC.files.map((f) => join(modelsDir, f.file))
    const tags = parseTags(await fs.readFile(csv, 'utf8'))
    // GPU (DirectML / CUDA) when allowed; fall back to CPU if it can't start.
    const gpu = useGpu ? gpuProvider() : null
    if (gpu) {
      try {
        const s = await o.InferenceSession.create(onnx, { executionProviders: [gpu, 'cpu'] })
        return new WdTagger(s, tags, gpu)
      } catch {
        /* fall through to CPU */
      }
    }
    const s = await o.InferenceSession.create(onnx, { executionProviders: ['cpu'] })
    return new WdTagger(s, tags, 'cpu')
  }

  async tag(img: RgbImage): Promise<TagResult> {
    const o = await ort()
    const input = await prepare(img)
    const feeds = { [this.session.inputNames[0]]: new o.Tensor('float32', input, [1, SIZE, SIZE, 3]) }
    const out = await this.session.run(feeds)
    const probs = out[this.session.outputNames[0]].data as Float32Array
    return toResult(probs, this.tags)
  }
}

// 448×448 BGR float input. One resize with fit 'contain' pads to a white
// square and scales in a single step. (sharp runs resize BEFORE extend no
// matter the call order, so extend()+resize() produced a cropped, wrongly
// sized buffer and garbage predictions.)
export async function prepare(img: RgbImage): Promise<Float32Array> {
  const { data, info } = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 3 }
  })
    .resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff', kernel: 'cubic' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== SIZE || info.height !== SIZE || info.channels !== 3) {
    throw new Error(`tagger input ${info.width}x${info.height}x${info.channels}`)
  }
  const input = new Float32Array(SIZE * SIZE * 3)
  for (let i = 0; i < SIZE * SIZE; i++) {
    input[i * 3] = data[i * 3 + 2] // B
    input[i * 3 + 1] = data[i * 3 + 1] // G
    input[i * 3 + 2] = data[i * 3] // R
  }
  return input
}

export function parseTags(csv: string): TagRow[] {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  const head = lines[0].split(',')
  const iName = head.indexOf('name')
  const iCat = head.indexOf('category')
  return lines.slice(1).map((l) => {
    const c = l.split(',')
    return { name: c[iName], category: Number(c[iCat]) }
  })
}

export function toResult(probs: ArrayLike<number>, tags: TagRow[]): TagResult {
  const rating = { general: 0, sensitive: 0, questionable: 0, explicit: 0 }
  const characters: TagResult['characters'] = []
  const general: TagResult['general'] = []
  for (let i = 0; i < tags.length && i < probs.length; i++) {
    const t = tags[i]
    const p = probs[i]
    if (t.category === 9) {
      if (t.name in rating) rating[t.name as keyof typeof rating] = p
    } else if (t.category === 4) {
      if (p >= CHAR_MIN) characters.push({ tag: t.name, score: p })
    } else if (p >= GENERAL_MIN) general.push({ tag: t.name, score: p })
  }
  characters.sort((a, b) => b.score - a.score)
  general.sort((a, b) => b.score - a.score)
  return { rating, characters, general }
}

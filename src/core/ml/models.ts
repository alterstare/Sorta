// Downloadable model files (CLAUDE.md §2: never committed, fetched on demand
// into <data>/models). Downloads resume from a .part file and are verified by
// size before being moved into place.
import { promises as fs, createWriteStream } from 'fs'
import { join } from 'path'
import type { ModelId, ModelInfo } from '../../shared/types'
import type { JobContext } from '../queue'

export interface ModelFile {
  file: string
  url: string
  bytes: number // expected size (progress before headers arrive)
}

export interface ModelSpec {
  id: ModelId
  label: string
  license: string
  note?: string
  files: ModelFile[]
}

const HF = 'https://huggingface.co'

// Main tagger: rating + character tags (2,751 characters).
export const TAGGER_SPEC: ModelSpec = {
  id: 'wd',
  label: 'WD SwinV2 Tagger v3 (등급 + 캐릭터, 기본)',
  license: 'Apache-2.0',
  files: [
    { file: 'wd-swinv2-v3.onnx', url: `${HF}/SmilingWolf/wd-swinv2-tagger-v3/resolve/main/model.onnx`, bytes: 467_000_000 },
    { file: 'wd-swinv2-v3-tags.csv', url: `${HF}/SmilingWolf/wd-swinv2-tagger-v3/resolve/main/selected_tags.csv`, bytes: 300_000 }
  ]
}

const PIXAI_TAGS: ModelFile = {
  file: 'pixai-tags.csv',
  url: `${HF}/deepghs/pixai-tagger-v0.9-onnx/resolve/main/selected_tags.csv`,
  bytes: 597_000
}

// Character → game table (PixAI's tag list carries each character's IP).
// Small; fetched alongside the main tagger.
export const SERIES_MAP_SPEC: ModelSpec = {
  id: 'series',
  label: '캐릭터 → 작품 대응표 (PixAI 태그 목록)',
  license: 'Apache-2.0',
  files: [PIXAI_TAGS]
}

// Assist #1: 3,720 characters, no rating head.
export const PIXAI_SPEC: ModelSpec = {
  id: 'pixai',
  label: 'PixAI Tagger v0.9 (보조 · 캐릭터 3,720명)',
  license: 'Apache-2.0',
  files: [{ file: 'pixai.onnx', url: `${HF}/deepghs/pixai-tagger-v0.9-onnx/resolve/main/model.onnx`, bytes: 1_271_365_854 }, PIXAI_TAGS]
}

// Assist #2: 26,968 characters but confident false positives → never decides alone.
export const CAMIE_SPEC: ModelSpec = {
  id: 'camie',
  label: 'Camie Tagger v2 (보조 · 캐릭터 26,968명)',
  license: 'GPL-3.0',
  files: [
    { file: 'camie.onnx', url: `${HF}/Camais03/camie-tagger-v2/resolve/main/camie-tagger-v2.onnx`, bytes: 788_983_561 },
    { file: 'camie-meta.json', url: `${HF}/Camais03/camie-tagger-v2/resolve/main/camie-tagger-v2-metadata.json`, bytes: 7_771_946 }
  ]
}

// Character learning: CCIP similarity embeddings + anime person detection.
export const CCIP_SPEC: ModelSpec = {
  id: 'ccip',
  label: '캐릭터 학습 모델 (CCIP + 인물 검출)',
  license: 'OpenRAIL · MIT',
  note: '모델에 없는 캐릭터를 참고 그림으로 학습해 찾습니다.',
  files: [
    {
      file: 'ccip-feat.onnx',
      url: `${HF}/deepghs/ccip_onnx/resolve/main/ccip-caformer-24-randaug-pruned/model_feat.onnx`,
      bytes: 150_248_245
    },
    {
      file: 'person-detect.onnx',
      url: `${HF}/deepghs/anime_person_detection/resolve/main/person_detect_v1.3_s/model.onnx`,
      bytes: 44_583_231
    }
  ]
}

export const MODEL_SPECS: Record<ModelId, ModelSpec> = {
  wd: TAGGER_SPEC,
  series: SERIES_MAP_SPEC,
  pixai: PIXAI_SPEC,
  camie: CAMIE_SPEC,
  ccip: CCIP_SPEC
}

export async function modelStatus(dir: string, spec: ModelSpec): Promise<ModelInfo> {
  let bytes = 0
  let installed = true
  for (const f of spec.files) {
    try {
      const st = await fs.stat(join(dir, f.file))
      bytes += st.size
      if (!st.size) installed = false
    } catch {
      installed = false
    }
  }
  return {
    id: spec.id,
    label: spec.label,
    license: spec.license,
    note: spec.note,
    installed,
    bytes,
    totalBytes: spec.files.reduce((s, f) => s + f.bytes, 0)
  }
}

// Files shared with another installed model stay (PixAI's tag list doubles as the series map).
export async function deleteModel(dir: string, spec: ModelSpec, keep: string[] = []): Promise<void> {
  for (const f of spec.files) {
    if (keep.includes(f.file)) continue
    await fs.rm(join(dir, f.file), { force: true })
    await fs.rm(join(dir, f.file + '.part'), { force: true })
  }
}

// Download every missing file of `spec`, reporting overall bytes.
export async function downloadModel(dir: string, spec: ModelSpec, ctx: JobContext): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  const total = spec.files.reduce((s, f) => s + f.bytes, 0)
  let base = 0
  let shown = -1
  // Bytes, but only re-sent when the shown MB changes (not per network chunk).
  const report = (n: number): void => {
    const mb = Math.floor(n / 1048576)
    if (mb === shown) return
    shown = mb
    ctx.report(Math.min(n, total), total, undefined, 'bytes')
  }
  for (const f of spec.files) {
    const dest = join(dir, f.file)
    const exists = await fs.stat(dest).then((s) => s.size > 0).catch(() => false)
    if (!exists) await downloadWithRetry(f, dest, ctx, (n) => report(base + n))
    base += f.bytes
    report(base)
  }
}

// A long download over HTTP can be cut mid-stream (the server or a proxy
// closes the connection; Node's fetch then fails with "terminated"). The
// partial file is kept, so retry and continue from where it stopped.
const RETRY_WAIT_MS = [2000, 5000, 10000, 20000, 30000]
async function downloadWithRetry(f: ModelFile, dest: string, ctx: JobContext, onBytes: (n: number) => void): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await downloadFile(f, dest, ctx, onBytes)
    } catch (e) {
      if (ctx.signal.aborted || i >= RETRY_WAIT_MS.length || /HTTP 4\d\d/.test(String((e as Error).message))) {
        throw new Error(`${f.file} 받기 실패: ${String((e as Error).message ?? e)} (다시 받으면 이어서 받습니다)`)
      }
      await new Promise((r) => setTimeout(r, RETRY_WAIT_MS[i]))
    }
  }
}

async function downloadFile(f: ModelFile, dest: string, ctx: JobContext, onBytes: (n: number) => void): Promise<void> {
  const part = dest + '.part'
  let have = await fs.stat(part).then((s) => s.size).catch(() => 0)
  const res = await fetch(f.url, {
    headers: have ? { Range: `bytes=${have}-` } : {},
    signal: ctx.signal,
    redirect: 'follow'
  })
  if (res.status === 416 && have) return fs.rename(part, dest) // the part was already complete
  if (res.status === 200) have = 0 // server ignored the range → start over
  else if (res.status !== 206) throw new Error(`${f.file}: HTTP ${res.status}`)
  if (!res.body) throw new Error(`${f.file}: empty response`)
  const len = Number(res.headers.get('content-length') ?? 0)
  const expected = len ? have + len : 0
  const out = createWriteStream(part, { flags: have ? 'a' : 'w' })
  let n = have
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      n += value.length
      onBytes(n)
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()))
  }
  const size = (await fs.stat(part)).size
  if (expected && size !== expected) throw new Error(`${f.file}: 크기 불일치 (${size} / ${expected})`)
  await fs.rename(part, dest)
}

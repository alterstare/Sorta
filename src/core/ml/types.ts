// Model interfaces (CLAUDE.md §2). Real ONNX implementations and test mocks
// both implement these, so the pipeline never depends on a concrete model.

// Decoded RGB image handed to the models (pre-processing is per model).
export interface RgbImage {
  width: number
  height: number
  data: Uint8Array // packed RGB, row-major
}

export interface TagResult {
  // Danbooru rating classes from the tagger.
  rating: { general: number; sensitive: number; questionable: number; explicit: number }
  // Character tags (`name_(series)`) with probabilities, highest first.
  characters: { tag: string; score: number }[]
  // General/attribute tags (hair color, outfit …) — optional signal.
  general: { tag: string; score: number }[]
}

export interface Tagger {
  readonly name: string
  tag(img: RgbImage): Promise<TagResult>
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
  score: number
}

export interface Detector {
  readonly name: string
  faces(img: RgbImage): Promise<Box[]>
  people(img: RgbImage): Promise<Box[]>
}

export interface Embedder {
  readonly name: string
  readonly dim: number
  embed(img: RgbImage): Promise<Float32Array>
}

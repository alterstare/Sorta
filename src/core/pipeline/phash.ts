// Perceptual hash (DCT pHash, 64 bits as 16 hex chars) for near-duplicate
// detection. Input: 32×32 grayscale pixels (row-major, 0..255).

const N = 32
const K = 8 // keep the top-left 8×8 low frequencies

// Precomputed DCT-II cosine table.
const COS: number[][] = Array.from({ length: K }, (_, u) =>
  Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)))
)

export function phashFromGray32(gray: Uint8Array | number[]): string {
  if (gray.length !== N * N) throw new Error(`phash expects ${N * N} pixels`)
  // Separable 2-D DCT restricted to the K×K block we keep.
  const rows: number[][] = []
  for (let y = 0; y < N; y++) {
    const r: number[] = []
    for (let u = 0; u < K; u++) {
      let s = 0
      for (let x = 0; x < N; x++) s += gray[y * N + x] * COS[u][x]
      r.push(s)
    }
    rows.push(r)
  }
  const dct: number[] = []
  for (let v = 0; v < K; v++) {
    for (let u = 0; u < K; u++) {
      let s = 0
      for (let y = 0; y < N; y++) s += rows[y][u] * COS[v][y]
      dct.push(s)
    }
  }
  // Median of the coefficients, skipping DC (index 0).
  const ac = dct.slice(1).sort((a, b) => a - b)
  const median = ac[Math.floor(ac.length / 2)]
  let hex = ''
  for (let i = 0; i < 64; i += 4) {
    let nib = 0
    for (let j = 0; j < 4; j++) nib = (nib << 1) | (dct[i + j] > median ? 1 : 0)
    hex += nib.toString(16)
  }
  return hex
}

export function hamming(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

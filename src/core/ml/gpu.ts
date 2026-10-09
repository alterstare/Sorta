// GPU execution provider per platform: DirectML on Windows (any DX12 GPU,
// NVIDIA included — the Windows onnxruntime-node build has no CUDA), CUDA on
// Linux x64 (needs the NVIDIA driver + CUDA 12 + cuDNN 9 installed). Callers
// fall back to CPU when the provider can't start.
export type GpuProvider = 'dml' | 'cuda'

export function gpuProvider(): GpuProvider | null {
  if (process.platform === 'win32') return 'dml'
  if (process.platform === 'linux' && process.arch === 'x64') return 'cuda'
  return null
}

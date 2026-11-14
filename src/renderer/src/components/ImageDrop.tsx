// A picture for the LLM (조직도 / 명부): click to pick, drop, or Ctrl+V while
// the dialog is open. The parent keeps the picture; its preview URL is freed
// when another one comes or the dialog closes.
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { UploadIcon } from './icons'

export interface PickedImage {
  data: Uint8Array
  name: string
  src: string // object URL for the preview
}

export default function ImageDrop({ image, onImage }: { image: PickedImage | null; onImage: (img: PickedImage) => void }): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const take = async (f: File | null | undefined): Promise<void> => {
    if (!f || !f.type.startsWith('image/')) return
    onImage({ data: new Uint8Array(await f.arrayBuffer()), name: f.name || '붙여넣은 그림', src: URL.createObjectURL(f) })
  }
  useEffect(() => {
    const paste = (e: ClipboardEvent): void => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'))
      if (f) (e.preventDefault(), void take(f))
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.src)
    },
    [image]
  )
  return (
    <div
      className={`org-import-drop ${image ? 'has' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void take(e.dataTransfer.files[0])
      }}
      onClick={() => fileRef.current?.click()}
    >
      {image ? (
        <img src={image.src} alt="" />
      ) : (
        <span>
          <UploadIcon />
          눌러서 그림 고르기 · 끌어다 놓기 · Ctrl+V
        </span>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void take(e.target.files?.[0])} />
    </div>
  )
}

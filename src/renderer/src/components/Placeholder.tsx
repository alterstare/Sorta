import type { JSX } from 'react'

// Screen not built yet (later phase).
export default function Placeholder({ title, phase }: { title: string; phase: number }): JSX.Element {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="hint">Phase {phase}에서 구현됩니다.</p>
    </div>
  )
}

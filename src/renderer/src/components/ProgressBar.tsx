// Bottom status line: the running background jobs and their progress.
import type { JSX } from 'react'
import { useStore } from '../store'
import { CloseIcon } from './icons'

export default function ProgressBar(): JSX.Element {
  const jobs = Object.values(useStore((s) => s.jobs))
  const cur = jobs.find((j) => j.state === 'running') ?? jobs[0]
  const pct = cur && cur.total > 0 ? Math.round((cur.done / cur.total) * 100) : null

  return (
    <footer className="statusbar">
      {cur ? (
        <>
          <span className="status-label">{cur.label}</span>
          <div className={`bar ${pct === null ? 'indeterminate' : ''}`}>
            <div className="bar-fill" style={pct === null ? undefined : { width: `${pct}%` }} />
          </div>
          <span className="status-count">{pct === null ? '' : `${cur.done} / ${cur.total}`}</span>
          {jobs.length > 1 && <span className="status-more">대기 {jobs.length - 1}개</span>}
          <button className="status-cancel" title="취소" onClick={() => void window.api.cancelJob(cur.jobId)}>
            <CloseIcon />
          </button>
        </>
      ) : (
        <span className="status-label idle">진행 중인 작업 없음</span>
      )}
    </footer>
  )
}

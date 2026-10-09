// Bottom status line: the running background jobs and their progress.
import type { JSX } from 'react'
import { useStore } from '../store'
import { CloseIcon } from './icons'

const mb = (n: number): string => Math.round(n / 1048576).toLocaleString()

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
          <span className="status-count">
            {pct === null ? '' : cur.unit === 'bytes' ? `${mb(cur.done)} / ${mb(cur.total)} MB` : `${cur.done.toLocaleString()} / ${cur.total.toLocaleString()}`}
          </span>
          {jobs.length > 1 && <span className="status-more">대기 {jobs.length - 1}개</span>}
          <button className="status-cancel" title="취소" onClick={() => void window.api.cancelJob(cur.jobId)}>
            <CloseIcon />
          </button>
        </>
      ) : (
        <span className="status-label idle">진행 중인 작업이 없습니다</span>
      )}
      <UpdateBadge />
    </footer>
  )
}

// 자동 업데이트 상태 (right end of the status bar).
function UpdateBadge(): JSX.Element | null {
  const u = useStore((s) => s.update)
  if (useStore.getState().info?.embedded) return null // Halftone updates itself
  if (u.state === 'downloading') return <span className="status-update">업데이트 {u.version} 받는 중 {u.percent ?? 0}%</span>
  if (u.state === 'downloaded')
    return (
      <span className="status-update ready">
        새 버전 {u.version} 준비 완료
        <button className="mini primary" onClick={() => window.api.installUpdate()}>
          재시작해서 업데이트
        </button>
      </span>
    )
  return null
}

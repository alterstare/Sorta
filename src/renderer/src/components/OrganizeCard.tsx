// 폴더 정리 (Phase 4): where sorted originals go, which images move, and the
// run itself — a preview first (counts per folder), then one undoable move.
import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { useKept } from '../keep'
import type { OrganizePlan } from '../../../shared/types'
import { CloseIcon, DriveFileMoveIcon } from './icons'

export default function OrganizeCard(): JSX.Element | null {
  const { settings, saveSettings, showToast, jobs, refreshLibrary } = useStore()
  const [plan, setPlan] = useKept<OrganizePlan | null>('organize.plan', null)
  const [busy, setBusy] = useState(false)
  if (!settings) return null
  const running = Object.keys(jobs).length > 0

  const preview = async (): Promise<void> => {
    setBusy(true)
    try {
      setPlan(await window.api.organizePlan())
    } finally {
      setBusy(false)
    }
  }
  const run = async (): Promise<void> => {
    setPlan(null)
    setBusy(true)
    try {
      showToast(await window.api.organize())
    } finally {
      setBusy(false)
      void refreshLibrary()
    }
  }
  const choice = <K extends 'moveAuto' | 'splitByRating'>(key: K, opts: [boolean, string][]): JSX.Element => (
    <div className="flat-group">
      {opts.map(([v, label]) => (
        <button key={String(v)} className={`mini ${settings[key] === v ? 'on' : ''}`} onClick={() => void saveSettings({ [key]: v })}>
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <section className="card">
      <h2>폴더 정리</h2>
      <div className="row">
        <div className="row-text">
          <div className="row-title">옮길 그림</div>
          <div className="row-desc">자동 확정된 그림도 옮길지, 직접 확인한 그림만 옮길지 정합니다. 검토 · 미확인 그림은 옮기지 않습니다.</div>
        </div>
        {choice('moveAuto', [
          [true, '자동 확정 포함'],
          [false, '직접 확인만']
        ])}
      </div>
      <div className="row">
        <div className="row-text">
          <div className="row-title">등급별 폴더</div>
          <div className="row-desc">일반 · 민감 · R-18 폴더를 맨 위에 두고 그 아래에 게임 폴더를 만듭니다.</div>
        </div>
        {choice('splitByRating', [
          [true, '분리'],
          [false, '통합']
        ])}
      </div>
      <div className="row">
        <div className="row-text">
          <div className="row-title">정리 실행</div>
          <div className="row-desc">
            게임/[소속/]캐릭터 · 게임/소속 · 게임/단체 · 단체 · 기타 규칙으로 원본을 옮깁니다. 파일 내용은 바꾸지 않고, Ctrl+Z로 한 번에
            되돌릴 수 있습니다. 정리한 그림은 분류가 바뀌면 새 폴더로 다시 옮겨집니다.
          </div>
        </div>
        <div className="flat-group">
          <button className="mini" disabled={!settings.organizeDir || running || busy} onClick={() => void preview()}>
            <DriveFileMoveIcon />
            미리 보기
          </button>
        </div>
      </div>
      {!settings.organizeDir && <div className="row-desc pad">위 폴더 칸에서 정리 폴더를 먼저 고르세요.</div>}

      {plan && (
        <div className="modal-back" onClick={() => setPlan(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>정리 미리 보기</h2>
              <button className="icon-btn" title="닫기" onClick={() => setPlan(null)}>
                <CloseIcon />
              </button>
            </div>
            <div className="modal-sum">
              옮길 그림 <b>{plan.moves.length.toLocaleString()}장</b> · 정리 완료 {plan.already.toLocaleString()}장 · 분류 미완료로 제외{' '}
              {plan.unsettled.toLocaleString()}장
            </div>
            <div className="modal-list">
              {plan.byFolder.map((f) => (
                <div className="modal-li" key={f.folder}>
                  <span className="selectable">{f.folder.split(/[\\/]/).join(' / ')}</span>
                  <span className="dim">{f.n.toLocaleString()}장</span>
                </div>
              ))}
              {plan.moves.length === 0 && <div className="row-desc pad">옮길 그림이 없습니다.</div>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPlan(null)}>
                취소
              </button>
              <button className="btn primary" disabled={!plan.moves.length || running} onClick={() => void run()}>
                <DriveFileMoveIcon />
                {plan.moves.length.toLocaleString()}장 옮기기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

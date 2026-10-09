// 공유 파일 (.sortapack): 내보내기 / 불러오기 dialogs for the 관리 tab.
import { useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import type { ManagedCharacter, PackPreview } from '../../../shared/types'
import { CheckIcon, CloseIcon, DownloadIcon, WarningIcon } from './icons'

function Check({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }): JSX.Element {
  return (
    <button className={`menu-opt ${on ? 'on' : ''}`} disabled={disabled} role="checkbox" aria-checked={on} onClick={onClick}>
      <span className="menu-box">{on && <CheckIcon />}</span>
      {children}
    </button>
  )
}

export function ExportDialog({ list, onClose }: { list: ManagedCharacter[]; onClose: () => void }): JSX.Element {
  const showToast = useStore((s) => s.showToast)
  const games = useMemo(() => {
    const m = new Map<number, { id: number; name: string; n: number; learned: number }>()
    for (const c of list) {
      const g = m.get(c.seriesId) ?? { id: c.seriesId, name: c.series, n: 0, learned: 0 }
      g.n++
      if (c.refs > 0) g.learned++
      m.set(c.seriesId, g)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [list])
  const [off, setOff] = useState<number[]>([])
  const [learned, setLearned] = useState(true)
  const [userRefs, setUserRefs] = useState(false)
  const [busy, setBusy] = useState(false)
  const chosen = games.filter((g) => !off.includes(g.id))

  const go = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.exportPack({ seriesIds: chosen.map((g) => g.id), includeLearned: learned, includeUserRefs: learned && userRefs })
      if (r) {
        showToast(r)
        if (r.ok) onClose()
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>공유 파일로 내보내기</h2>
          <button className="icon-btn" title="닫기" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="row-desc">
          고른 게임의 소속 조직도, 캐릭터(이름 · 별칭 · 태그 · 복장 버전), 학습 데이터를 .sortapack 파일 하나로 저장합니다. 그림 파일은 들어가지 않습니다.
        </div>
        <div className="pack-sec">
          <div className="row-title">게임</div>
          <div className="flat-group">
            <button className="mini" onClick={() => setOff([])}>
              전체 선택
            </button>
            <button className="mini" onClick={() => setOff(games.map((g) => g.id))}>
              전체 선택 해제
            </button>
          </div>
        </div>
        <div className="modal-list pack-games">
          {games.map((g) => (
            <Check key={g.id} on={!off.includes(g.id)} onClick={() => setOff((x) => (x.includes(g.id) ? x.filter((i) => i !== g.id) : [...x, g.id]))}>
              <span className="pack-game">{g.name}</span>
              <span className="dim">
                캐릭터 {g.n}명{g.learned ? ` · 학습 ${g.learned}명` : ''}
              </span>
            </Check>
          ))}
        </div>
        <Check on={learned} onClick={() => setLearned(!learned)}>
          학습 데이터 포함 (Danbooru 참고 그림의 특징값)
        </Check>
        <Check on={learned && userRefs} disabled={!learned} onClick={() => setUserRefs(!userRefs)}>
          내 그림에서 나온 학습 데이터도 포함
        </Check>
        {learned && userRefs && (
          <div className="pack-warn">
            <WarningIcon />
            검토에서 직접 확정한 내 그림의 특징값이 파일에 들어갑니다. 그림 자체는 들어가지 않고 특징값으로 그림을 되살릴 수는 없지만, 내 그림에서 나온
            데이터입니다. 믿을 수 있는 사람과만 공유하세요.
          </div>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={!chosen.length || busy} onClick={() => void go()}>
            <DownloadIcon />
            {busy ? '저장 중…' : `${chosen.length}개 게임 내보내기`}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ImportDialog({ file, onClose }: { file: string; onClose: () => void }): JSX.Element {
  const showToast = useStore((s) => s.showToast)
  const [overwrite, setOverwrite] = useState(false)
  const [learned, setLearned] = useState(true)
  const [pv, setPv] = useState<PackPreview | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    window.api
      .previewPack(file, { overwrite, learned })
      .then((p) => (setPv(p), setErr('')))
      .catch((e) => setErr(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }, [file, overwrite, learned])
  const go = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.importPack(file, { overwrite, learned })
      showToast(r)
      if (r.ok) onClose()
    } finally {
      setBusy(false)
    }
  }
  const name = file.split(/[\\/]/).pop()
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>공유 파일 불러오기</h2>
          <button className="icon-btn" title="닫기" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="row-desc selectable">{name}</div>
        {err && <div className="pack-warn">{err}</div>}
        {pv && (
          <>
            <div className="pack-stats">
              <span>
                게임 <b>{pv.games}</b>개{pv.newGames ? ` (새 게임 ${pv.newGames})` : ''}
              </span>
              <span>
                새 캐릭터 <b>{pv.newCharacters}</b>명
              </span>
              <span>
                새 소속 <b>{pv.newAffiliations}</b>개
              </span>
              <span>
                학습 캐릭터 <b>{pv.learnedCharacters}</b>명 · 참고 {pv.refs.toLocaleString()}개
              </span>
            </div>
            <div className="dim">
              Sorta {pv.app} · {new Date(pv.createdAt).toLocaleString()}에 만든 파일
            </div>
            {pv.modelMismatch && <div className="pack-warn">다른 학습 모델로 만든 파일이라 학습 데이터는 가져올 수 없습니다. 게임 · 소속 · 캐릭터만 가져옵니다.</div>}
            {pv.userRefs > 0 && learned && (
              <div className="dim">보낸 사람이 직접 확정한 그림에서 나온 학습 데이터 {pv.userRefs}개가 들어 있습니다.</div>
            )}
            <Check on={learned && !pv.modelMismatch} disabled={pv.modelMismatch} onClick={() => setLearned(!learned)}>
              학습 데이터 가져오기
            </Check>
            <div className="pack-sec">
              <div className="row-title">겹치는 소속 배치</div>
              <div className="flat-group">
                <button className={`mini ${!overwrite ? 'on' : ''}`} onClick={() => setOverwrite(false)}>
                  내 것 유지
                </button>
                <button className={`mini ${overwrite ? 'on' : ''}`} onClick={() => setOverwrite(true)}>
                  파일 내용으로 덮어쓰기
                </button>
              </div>
            </div>
            {pv.conflicts.length > 0 ? (
              <div className="modal-list">
                {pv.conflicts.map((c) => (
                  <div className="modal-li" key={c}>
                    {c}
                  </div>
                ))}
              </div>
            ) : (
              <div className="dim">내 소속 배치와 다른 항목이 없습니다.</div>
            )}
            <div className="row-desc">
              같은 캐릭터 · 소속은 태그와 이름(이전 이름 포함)으로 맞춥니다. 별칭은 합쳐지고, 소속이 없는 캐릭터에는 파일의 소속이 들어갑니다. 전체를 Ctrl+Z 한
              번으로 되돌릴 수 있습니다.
            </div>
          </>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" disabled={!pv || busy} onClick={() => void go()}>
            <CheckIcon />
            {busy ? '불러오는 중…' : '불러오기'}
          </button>
        </div>
      </div>
    </div>
  )
}

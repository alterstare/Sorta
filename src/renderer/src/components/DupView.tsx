// 중복 정리: near-identical pictures side by side. Pick the ones to drop (at
// first the copies of the largest), set them aside — they move to
// <정리 폴더>/중복 and leave the library (Ctrl+Z brings them back) — or mark
// the group as not duplicates.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { blocking, useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import type { DupGroup } from '../../../shared/types'
import { CheckIcon, DriveFileMoveIcon, FolderOpenIcon } from './icons'
import { fmtSize, RATING_LABEL } from './ThumbGrid'

export default function DupView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const libraryVersion = useStore((s) => s.libraryVersion)
  const showToast = useStore((s) => s.showToast)
  const setView = useStore((s) => s.setView)
  const running = useStore((s) => blocking(s.jobs))
  const [groups, setGroups] = useKept<DupGroup[] | null>('dups.groups', null)
  // per group: the pictures picked to drop (absent = the copies of the first, the largest)
  const [drop, setDrop] = useKept<Record<string, number[]>>('dups.drop', {})
  const [busy, setBusy] = useState(false)
  const scrollRef = useKeptScroll<HTMLDivElement>('dups')

  useEffect(() => {
    void window.api.duplicates().then(async (g) => {
      setGroups(g)
      // The tree's count was unknown until this first check: refresh just the tree.
      const st = useStore.getState()
      if (st.tree?.dups === null) useStore.setState({ tree: await window.api.tree(st.filter.ratings, st.filter.groups) })
    })
  }, [libraryVersion, setGroups])

  const dropped = (g: DupGroup): number[] => {
    const d = drop[g.key]
    return d ? g.images.filter((i) => d.includes(i.id)).map((i) => i.id) : g.images.slice(1).filter((i) => i.near).map((i) => i.id)
  }
  const toggle = (g: DupGroup, id: number): void => {
    const d = dropped(g)
    setDrop({ ...drop, [g.key]: d.includes(id) ? d.filter((x) => x !== id) : [...d, id] })
  }
  const setAside = async (ids: number[]): Promise<void> => {
    setBusy(true)
    try {
      showToast(await window.api.setAside(ids))
    } finally {
      setBusy(false)
    }
  }
  const mode = (r: string): string =>
    r === 'r18' ? (settings?.safeR18 ?? 'show') : r === 'sensitive' ? (settings?.safeSensitive ?? 'show') : 'show'

  if (!groups) return <div className="grid" />
  const total = groups.reduce((n, g) => n + dropped(g).length, 0)
  return (
    <div className="dups" ref={scrollRef}>
      <div className="dups-head">
        <div>
          <b>비슷한 그림 묶음 {groups.length}개</b>
          <span className="dim"> · 정리하면 {total}장이 빠집니다</span>
        </div>
        <span className="spacer" />
        {groups.length > 0 && (
          <div className="flat-group">
            <button
              className="mini"
              disabled={busy || running || !settings?.organizeDir || total === 0}
              title="각 묶음에서 삭제할 그림(체크)을 정리 폴더의 중복 폴더로 옮깁니다"
              onClick={() => void setAside(groups.flatMap(dropped))}
            >
              <DriveFileMoveIcon />
              모두 정리 ({total}장)
            </button>
          </div>
        )}
      </div>
      <p className="hint">
        삭제할 그림을 고르고 "선택한 그림 따로 두기"를 누르면 정리 폴더의 "중복" 폴더로 옮겨지고 라이브러리에서 빠집니다. 지우지는 않으며
        Ctrl+Z로 되돌릴 수 있습니다. 처음에는 해상도가 가장 큰 그림의 복사본이 선택되어 있습니다. 완전히 같은 파일은 가져올 때 정리 폴더의 "삭제됨" 폴더로 옮겨집니다.
      </p>
      {!settings?.organizeDir && (
        <div className="row-desc pad">
          따로 두려면 정리 폴더가 필요합니다.{' '}
          <button className="link-btn" onClick={() => setView('settings')}>
            설정에서 정하기
          </button>
        </div>
      )}
      {groups.length === 0 && <div className="empty">비슷한 그림이 없습니다.</div>}
      {groups.map((g) => {
        const d = dropped(g)
        return (
          <section key={g.key} className="dup-group card">
            <div className="dup-row">
              {g.images.map((i) => {
                const on = d.includes(i.id)
                const m = mode(i.rating)
                return (
                  <div key={i.id} className={`dup-item ${on ? 'on' : ''}`} onClick={() => toggle(g, i.id)}>
                    <div className="dup-thumb">
                      {m !== 'hide' && i.thumb && (
                        <img src={window.api.imageUrl(i.thumb)} className={m === 'blur' ? 'blur' : ''} loading="lazy" />
                      )}
                      <span className="dup-keep">{on && <CheckIcon />}</span>
                    </div>
                    <div className="dup-name" title={i.path}>
                      {i.name}
                    </div>
                    <div className="dup-meta">
                      {i.width && i.height ? `${i.width}×${i.height}` : ''} · {fmtSize(i.size)} · {RATING_LABEL[i.rating]}
                    </div>
                    <div className="dup-meta">{i.characters.join(', ') || '캐릭터 미지정'}</div>
                    <div className="dup-meta">{i.id === g.images[0].id ? '가장 큰 그림' : `닮음 ${i.similarity}%`}</div>
                    <button
                      className="mini icon"
                      title="폴더에서 보기"
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.api.showInFolder(i.path)
                      }}
                    >
                      <FolderOpenIcon />
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="flat-group">
              <button
                className="mini"
                disabled={busy || running || !settings?.organizeDir || d.length === 0}
                onClick={() => void setAside(d)}
              >
                <DriveFileMoveIcon />
                선택한 그림 따로 두기 ({d.length}장)
              </button>
              <button
                className="mini"
                onClick={() =>
                  void window.api
                    .notDuplicate(g.images.map((i) => i.id))
                    .then(() => showToast({ ok: true, message: '다른 그림으로 표시 · Ctrl+Z로 되돌리기' }))
                }
              >
                다른 그림으로 표시
              </button>
            </div>
          </section>
        )
      })}
    </div>
  )
}

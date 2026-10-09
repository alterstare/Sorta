// 중복 정리: near-identical pictures side by side. Pick the one to keep
// (the largest is suggested), set the rest aside — they move to
// <정리 폴더>/중복 and leave the library (Ctrl+Z brings them back) — or mark
// the group as not duplicates.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import type { DupGroup } from '../../../shared/types'
import { CheckIcon, DriveFileMoveIcon, FolderOpenIcon } from './icons'
import { fmtSize, RATING_LABEL } from './ThumbGrid'

export default function DupView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const libraryVersion = useStore((s) => s.libraryVersion)
  const showToast = useStore((s) => s.showToast)
  const setView = useStore((s) => s.setView)
  const running = useStore((s) => Object.keys(s.jobs).length > 0)
  const [groups, setGroups] = useKept<DupGroup[] | null>('dups.groups', null)
  const [keep, setKeep] = useKept<Record<string, number>>('dups.keep', {})
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

  const kept = (g: DupGroup): number => (g.images.some((i) => i.id === keep[g.key]) ? keep[g.key] : g.images[0].id)
  const others = (g: DupGroup): number[] => g.images.filter((i) => i.id !== kept(g)).map((i) => i.id)
  const setAside = async (ids: number[]): Promise<void> => {
    setBusy(true)
    try {
      showToast(await window.api.setAside(ids))
    } finally {
      setBusy(false)
    }
  }
  const mode = (r: string): string => (r === 'r18' ? settings?.safeR18 ?? 'show' : r === 'sensitive' ? settings?.safeSensitive ?? 'show' : 'show')

  if (!groups) return <div className="grid" />
  const total = groups.reduce((n, g) => n + g.images.length - 1, 0)
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
              disabled={busy || running || !settings?.organizeDir}
              title="각 묶음에서 남길 그림(체크)만 두고 나머지를 정리 폴더의 중복 폴더로 옮깁니다"
              onClick={() => void setAside(groups.flatMap(others))}
            >
              <DriveFileMoveIcon />
              모두 정리 ({total}장)
            </button>
          </div>
        )}
      </div>
      <p className="hint">
        남길 그림을 고르고 "나머지 따로 두기"를 누르면 나머지는 정리 폴더의 "중복" 폴더로 옮겨지고 라이브러리에서 빠집니다. 지우지는 않으며 Ctrl+Z로
        되돌릴 수 있습니다. 기본 선택은 해상도가 가장 큰 그림입니다.
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
      {groups.map((g) => (
        <section key={g.key} className="dup-group card">
          <div className="dup-row">
            {g.images.map((i) => {
              const on = kept(g) === i.id
              const m = mode(i.rating)
              return (
                <div key={i.id} className={`dup-item ${on ? 'on' : ''}`} onClick={() => setKeep({ ...keep, [g.key]: i.id })}>
                  <div className="dup-thumb">
                    {m !== 'hide' && i.thumb && <img src={window.api.imageUrl(i.thumb)} className={m === 'blur' ? 'blur' : ''} loading="lazy" />}
                    <span className="dup-keep">{on && <CheckIcon />}</span>
                  </div>
                  <div className="dup-name" title={i.path}>
                    {i.name}
                  </div>
                  <div className="dup-meta">
                    {i.width && i.height ? `${i.width}×${i.height}` : ''} · {fmtSize(i.size)} · {RATING_LABEL[i.rating]}
                  </div>
                  <div className="dup-meta">{i.characters.join(', ') || '캐릭터 미지정'}</div>
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
            <button className="mini" disabled={busy || running || !settings?.organizeDir} onClick={() => void setAside(others(g))}>
              <DriveFileMoveIcon />
              나머지 따로 두기 ({g.images.length - 1}장)
            </button>
            <button
              className="mini"
              onClick={() => void window.api.notDuplicate(g.images.map((i) => i.id)).then(() => showToast({ ok: true, message: '다른 그림으로 표시 · Ctrl+Z로 되돌리기' }))}
            >
              다른 그림으로 표시
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}

// 미확인 (CLAUDE.md §5.6): unknown pictures grouped by look-alike main
// person. Name a group once → every picture in it is confirmed (and learned
// from); pictures that don't belong can be left out first.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import type { ClusterResult, Rating, UnknownCluster } from '../../../shared/types'
import CharacterPicker from './CharacterPicker'
import { CheckIcon, KeyboardArrowLeftIcon, PersonOffIcon } from './icons'

type Img = UnknownCluster['images'][number]

function Thumb({ img, off, onClick }: { img: Img; off?: boolean; onClick?: () => void }): JSX.Element {
  const settings = useStore((s) => s.settings)
  const mode = !settings ? 'show' : ({ r18: settings.safeR18, sensitive: settings.safeSensitive } as Partial<Record<Rating, string>>)[img.rating] ?? 'show'
  return (
    <div className={`unk-thumb ${off ? 'off' : ''}`} onClick={onClick} title={img.path}>
      {mode !== 'hide' && <img src={window.api.imageUrl(img.thumb ?? img.path)} className={mode === 'blur' ? 'blur' : ''} loading="lazy" />}
      {onClick && <span className="unk-check">{!off && <CheckIcon />}</span>}
    </div>
  )
}

export default function UnknownView(): JSX.Element {
  const listRef = useKeptScroll<HTMLDivElement>('unknown.list')
  const { showToast, refreshLibrary, models } = useStore()
  const libraryVersion = useStore((s) => s.libraryVersion)
  const [res, setRes] = useKept<ClusterResult | null>('unknown.res', null)
  const [open, setOpen] = useKept<UnknownCluster | null>('unknown.open', null)
  const detailRef = useKeptScroll<HTMLDivElement>(`unknown.detail.${open?.key ?? ''}`)
  const [off, setOff] = useKept<Set<number>>('unknown.off', new Set())
  const [creating, setCreating] = useState(false)
  const ccip = models.find((m) => m.id === 'ccip')

  useEffect(() => {
    void window.api.unknownClusters().then((r) => {
      setRes(r)
      // The open group changed underneath (named / undone) → back to the list.
      setOpen((o) => (o && r.clusters.some((c) => c.key === o.key) ? o : null))
    })
  }, [libraryVersion])

  const chosen = open ? open.images.filter((i) => !off.has(i.id)).map((i) => i.id) : []
  const show = (c: UnknownCluster | null): void => {
    setOpen(c)
    setOff(new Set())
    setCreating(false)
  }
  const apply = async (fn: () => Promise<void>, msg: string): Promise<void> => {
    await fn()
    showToast({ ok: true, message: `${msg} · Ctrl+Z로 되돌리기` })
    show(null)
    void refreshLibrary()
  }

  if (open) {
    return (
      <div ref={detailRef} className="page unknown">
        <div className="page-head">
          <div className="flat-group">
            <button className="mini" onClick={() => show(null)}>
              <KeyboardArrowLeftIcon />
              묶음 목록
            </button>
          </div>
          <h1>닮은 그림 {open.images.length}장</h1>
        </div>
        <p className="hint">이 묶음의 캐릭터 이름을 고르면 선택된 그림이 모두 그 캐릭터로 확정됩니다. 다른 캐릭터 그림은 눌러서 빼세요.</p>
        <div className="unk-detail">
          <div className="unk-grid big">
            {open.images.map((i) => (
              <Thumb
                key={i.id}
                img={i}
                off={off.has(i.id)}
                onClick={() =>
                  setOff((s) => {
                    const n = new Set(s)
                    if (n.has(i.id)) n.delete(i.id)
                    else n.add(i.id)
                    return n
                  })
                }
              />
            ))}
          </div>
          <aside className="unk-side card">
            <div className="row-title">
              선택 {chosen.length}장{off.size > 0 && <span className="dim"> · 제외 {off.size}장</span>}
            </div>
            <CharacterPicker
              newMode={creating}
              onNewModeChange={setCreating}
              onPick={(c) => chosen.length && void apply(() => window.api.confirmCharacters(chosen, [c.id]), `${chosen.length}장 → ${c.name}`)}
            />
            <div className="flat-group">
              <button className="mini" disabled={!chosen.length} onClick={() => void apply(() => window.api.markOther(chosen), `${chosen.length}장 캐릭터 아닌 그림으로 지정`)}>
                <PersonOffIcon />
                캐릭터 아닌 그림
              </button>
            </div>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div ref={listRef} className="page unknown">
      <h1>미확인</h1>
      <p className="hint">어떤 모델도 캐릭터를 찾지 못한 그림을 서로 닮은 것끼리 묶었습니다. 묶음에 이름을 한 번 붙이면 전체에 적용되고, 학습에도 쓰입니다.</p>
      {!ccip?.installed && (
        <div className="row-desc pad">묶으려면 설정 → 모델에서 캐릭터 학습 모델(CCIP)을 받으세요.</div>
      )}
      {res && (
        <div className="row-desc pad">
          묶음 {res.clusters.length}개 ({res.clusters.reduce((n, c) => n + c.images.length, 0).toLocaleString()}장) · 단독 그림{' '}
          {res.loose.toLocaleString()}장{res.notEmbedded > 0 && ` · 비교 대기 ${res.notEmbedded.toLocaleString()}장`}
        </div>
      )}
      <div className="unk-cards">
        {res?.clusters.map((c) => (
          <button key={c.key} className="unk-card" onClick={() => show(c)}>
            <div className="unk-grid">
              {c.images.slice(0, 6).map((i) => (
                <Thumb key={i.id} img={i} />
              ))}
            </div>
            <div className="unk-card-foot">
              <b>{c.images.length}장</b>
              <span className="dim">유사도 {c.similarity.toFixed(2)} 이상</span>
            </div>
          </button>
        ))}
      </div>
      {res && res.clusters.length === 0 && ccip?.installed && <div className="empty">묶을 미확인 그림이 없습니다.</div>}
    </div>
  )
}

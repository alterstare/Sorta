// Rating stars + the favorite / group pill under a thumbnail (as in
// Halftone's card footer). Clicks act on the image (or the selection it is
// part of) and never open the viewer.
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import type { ImageItem } from '../../../shared/types'
import { AddIcon, CheckIcon, FavoriteIcon, StarIcon } from './icons'
import { setStars, toggleFavorite, toggleGroup } from '../collect'

// A selector must not return a fresh [] each call (endless re-render).
const NO_GROUPS: { id: number; name: string }[] = []

// 5 stars: click N → N stars; click the current value → none.
export function Stars({ imgs, size = 14 }: { imgs: ImageItem[]; size?: number }): JSX.Element {
  const value = imgs[0]?.stars ?? 0
  const [hover, setHover] = useState(0)
  return (
    <span className="stars" style={{ fontSize: size }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`star ${n <= (hover || value) ? 'on' : ''} ${hover ? 'preview' : ''}`}
          title={`${n}점`}
          onMouseEnter={() => setHover(n)}
          onClick={(e) => {
            e.stopPropagation()
            void setStars(imgs, n === value ? 0 : n)
          }}
        >
          <StarIcon />
        </span>
      ))}
    </span>
  )
}

// ♥ | ＋ in one framed pill; `noGroup` drops the ＋ (small icons: right-click only).
export function FavGroup({ imgs, noGroup = false }: { imgs: ImageItem[]; noGroup?: boolean }): JSX.Element {
  const fav = imgs.length > 0 && imgs.every((i) => i.favorite)
  return (
    <span className="seg" onClick={(e) => e.stopPropagation()}>
      <span className={`seg-btn heart ${fav ? 'on' : ''}`} title={fav ? '즐겨찾기 해제' : '즐겨찾기'} onClick={() => void toggleFavorite(imgs)}>
        <FavoriteIcon filled={fav} />
      </span>
      {!noGroup && <GroupButton imgs={imgs} />}
    </span>
  )
}

// ＋ → popover: every group with a check (click toggles), then "새 그룹".
function GroupButton({ imgs }: { imgs: ImageItem[] }): JSX.Element {
  const groups = useStore((s) => s.tree?.groups) ?? NO_GROUPS
  const setGroupDialog = useStore((s) => s.setGroupDialog)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btn = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const inAny = imgs.some((i) => i.groups.length > 0)
  useEffect(() => {
    if (!pos) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setPos(null)
    }
    const onScroll = (): void => setPos(null)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [pos])
  return (
    <span
      ref={btn}
      className={`seg-btn group ${inAny ? 'on' : ''}`}
      title="그룹에 추가"
      onClick={() => {
        if (pos) return setPos(null)
        const r = btn.current!.getBoundingClientRect()
        const W = 200
        setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)) })
      }}
    >
      <AddIcon />
      {pos &&
        createPortal(
          <div ref={panel} className="group-pop" style={pos} onClick={(e) => e.stopPropagation()}>
            {groups.length === 0 && <div className="group-pop-empty">그룹이 없습니다</div>}
            {groups.map((g) => {
              const on = imgs.every((i) => i.groups.includes(g.id))
              return (
                <button key={g.id} className={`group-pop-opt ${on ? 'on' : ''}`} onClick={() => void toggleGroup(imgs, g)}>
                  <span className="menu-box">{on && <CheckIcon />}</span>
                  {g.name}
                </button>
              )
            })}
            <button
              className="group-pop-opt new"
              onClick={() => {
                setPos(null)
                setGroupDialog(imgs.map((i) => i.id))
              }}
            >
              <AddIcon />새 그룹
            </button>
          </div>,
          document.body
        )}
    </span>
  )
}

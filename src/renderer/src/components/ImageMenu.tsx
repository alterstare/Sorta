// Right-click menu for images (grid, list, viewer): copy the image, copy the
// character names, favorite, groups, show in folder. Acts on the selection
// when the clicked image is part of it.
import { useCallback, useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { useStore } from '../store'
import type { ImageItem } from '../../../shared/types'
import ContextMenu from './ContextMenu'
import type { MenuItem } from './ContextMenu'
import { AddIcon, CheckIcon, ContentCopyIcon, DeleteIcon, GroupsIcon, FavoriteIcon, FolderOpenIcon, StarIcon } from './icons'
import { characterNames, characterTags, copyImage, copyNames, copyText, createGroup, setStars, toggleFavorite, toggleGroup } from '../collect'

export function useImageMenu(items: ImageItem[]): {
  onContextMenu: (e: MouseEvent, img: ImageItem) => void
  menu: JSX.Element | null
} {
  const [at, setAt] = useState<{ x: number; y: number; imgs: ImageItem[] } | null>(null)
  const close = useCallback(() => setAt(null), [])
  const onContextMenu = (e: MouseEvent, img: ImageItem): void => {
    e.preventDefault()
    e.stopPropagation()
    const sel = useStore.getState().selected
    const imgs = sel.has(img.id) && sel.size > 1 ? items.filter((i) => sel.has(i.id)) : [img]
    setAt({ x: e.clientX, y: e.clientY, imgs })
  }
  if (!at) return { onContextMenu, menu: null }
  const imgs = at.imgs
  const one = imgs.length === 1
  const fav = imgs.every((i) => i.favorite)
  const groups = useStore.getState().tree?.groups ?? []
  const names = characterNames(imgs)
  const tags = characterTags(imgs)
  const items_: MenuItem[] = [
    { label: one ? '이미지 복사' : '이미지 복사 (한 장만 가능)', icon: <ContentCopyIcon />, disabled: !one, onClick: () => void copyImage(imgs[0]) },
    {
      label: names ? `캐릭터 이름 복사 (${names.length > 24 ? names.slice(0, 24) + '…' : names})` : '캐릭터 이름 복사',
      icon: <ContentCopyIcon />,
      disabled: !names,
      onClick: () => void copyNames(imgs)
    },
    {
      label: tags ? `캐릭터 태그 복사 (${tags.length > 28 ? tags.slice(0, 28) + '…' : tags})` : '캐릭터 태그 복사',
      icon: <ContentCopyIcon />,
      disabled: !tags,
      onClick: () => void copyText(tags, '태그 복사')
    },
    {
      label: fav ? '즐겨찾기 해제' : '즐겨찾기에 추가',
      icon: <FavoriteIcon filled={fav} />,
      separator: true,
      onClick: () => void toggleFavorite(imgs)
    },
    {
      label: '그룹에 추가',
      icon: <AddIcon />,
      children: [
        ...groups.map((g) => ({
          label: g.name,
          icon: imgs.every((i) => i.groups.includes(g.id)) ? <CheckIcon /> : undefined,
          onClick: () => void toggleGroup(imgs, g)
        })),
        { label: '새 그룹…', icon: <AddIcon />, separator: groups.length > 0, onClick: () => useStore.getState().setGroupDialog(imgs.map((i) => i.id)) }
      ]
    },
    {
      label: '평점',
      icon: <StarIcon />,
      children: [5, 4, 3, 2, 1, 0].map((n) => ({
        label: n ? `${n}점` : '평점 지우기',
        icon: imgs.every((i) => i.stars === n) ? <CheckIcon /> : undefined,
        onClick: () => void setStars(imgs, n)
      }))
    },
    { label: '폴더에서 보기', icon: <FolderOpenIcon />, separator: true, disabled: !one, onClick: () => void window.api.showInFolder(imgs[0].path) },
    {
      label: one ? '삭제 (휴지통으로)' : `${imgs.length}장 삭제 (휴지통으로)`,
      icon: <DeleteIcon />,
      separator: true,
      onClick: () => useStore.getState().setTrashDialog(imgs.map((i) => i.id))
    }
  ]
  return { onContextMenu, menu: <ContextMenu x={at.x} y={at.y} items={items_} onClose={close} /> }
}

// 단체 사진으로 분류: which game (or none) — 정리 폴더/게임/단체 or /단체.
export function GroupShotDialog(): JSX.Element | null {
  const d = useStore((s) => s.groupShotDialog)
  const setD = useStore((s) => s.setGroupShotDialog)
  const showToast = useStore((s) => s.showToast)
  const [names, setNames] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  if (!!d !== wasOpen) {
    setWasOpen(!!d)
    if (d) {
      setPick(d.suggest ?? '')
      void window.api.seriesNames().then(setNames)
    }
  }
  if (!d) return null
  const close = (): void => setD(null)
  const go = async (): Promise<void> => {
    close()
    await window.api.markGroup(d.ids, pick || null)
    showToast({ ok: true, message: `${d.ids.length > 1 ? `${d.ids.length}장 ` : ''}단체 사진으로 분류${pick ? ` (${pick})` : ''} · Ctrl+Z로 되돌리기` })
    d.after?.()
  }
  const list = pick && !names.includes(pick) ? [pick, ...names] : names
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>단체 사진으로 분류</h2>
        </div>
        <div className="row-desc">누가 있는지는 정하지 않습니다. 게임을 고르면 정리 폴더의 게임/단체, 모르면 단체 폴더로 옮겨집니다.</div>
        <select
          className="tag-input"
          autoFocus
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go()
            if (e.key === 'Escape') close()
          }}
        >
          <option value="">게임 모름</option>
          {list.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="modal-foot">
          <button className="btn" onClick={close}>
            취소
          </button>
          <button className="btn primary" onClick={() => void go()}>
            <GroupsIcon />
            단체 사진으로 분류
          </button>
        </div>
      </div>
    </div>
  )
}

// 삭제 확인: the files go to the recycle bin (restorable there), the
// pictures leave the library.
export function TrashDialog(): JSX.Element | null {
  const ids = useStore((s) => s.trashDialog)
  const setIds = useStore((s) => s.setTrashDialog)
  const showToast = useStore((s) => s.showToast)
  const setSelected = useStore((s) => s.setSelected)
  const openViewer = useStore((s) => s.openViewer)
  const [busy, setBusy] = useState(false)
  if (!ids) return null
  const close = (): void => setIds(null)
  const go = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.trash(ids)
    setBusy(false)
    close()
    setSelected(new Set())
    openViewer(null)
    showToast(r)
  }
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{ids.length}장 삭제</h2>
        </div>
        <div className="row-desc">원본 파일을 휴지통으로 보내고 라이브러리에서 뺍니다. Ctrl+Z로는 되돌릴 수 없고, 휴지통에서 복원한 뒤 다시 가져오면 돌아옵니다.</div>
        <div className="modal-foot">
          <button className="btn" onClick={close}>
            취소
          </button>
          <button
            className="btn danger"
            autoFocus
            disabled={busy}
            onClick={() => void go()}
            onKeyDown={(e) => e.key === 'Escape' && close()}
          >
            <DeleteIcon />
            {busy ? '보내는 중…' : '휴지통으로 보내기'}
          </button>
        </div>
      </div>
    </div>
  )
}

// "새 그룹" / "그룹 이름 변경" dialog (from the ＋ popover, the right-click
// menu, or the tree).
export function NewGroupDialog(): JSX.Element | null {
  const ids = useStore((s) => s.groupDialog)
  const setIds = useStore((s) => s.setGroupDialog)
  const rename = useStore((s) => s.renameGroup)
  const setRename = useStore((s) => s.setRenameGroup)
  const showToast = useStore((s) => s.showToast)
  const [name, setName] = useState('')
  const open = ids !== null || rename !== null
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    setName(rename?.name ?? '')
  }
  if (!open) return null
  const close = (): void => (setIds(null), setRename(null))
  const done = async (): Promise<void> => {
    if (!name.trim()) return
    if (rename) {
      try {
        await window.api.renameGroup(rename.id, name)
        showToast({ ok: true, message: '그룹 이름 변경 · Ctrl+Z로 되돌리기' })
        close()
      } catch (e) {
        showToast({ ok: false, message: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      }
    } else if (await createGroup(name, ids ?? [])) close()
  }
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{rename ? '그룹 이름 변경' : '새 그룹'}</h2>
        </div>
        <input
          className="tag-input"
          autoFocus
          value={name}
          placeholder="그룹 이름"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void done()
            if (e.key === 'Escape') close()
          }}
        />
        {!rename && <div className="row-desc">{ids?.length ? `선택한 그림 ${ids.length}장을 이 그룹에 넣습니다.` : '빈 그룹을 만듭니다.'}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={close}>
            취소
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={() => void done()}>
            {rename ? '바꾸기' : '만들기'}
          </button>
        </div>
      </div>
    </div>
  )
}

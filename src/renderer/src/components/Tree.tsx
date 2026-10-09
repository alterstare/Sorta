// Left tree: 게임 → 캐릭터 with image counts, plus the status nodes.
import type { JSX } from 'react'
import { useStore } from '../store'
import { useKept } from '../keep'
import { useState } from 'react'
import ContextMenu from './ContextMenu'
import { AddIcon, DeleteIcon, EditIcon } from './icons'
import type { LibraryNode, TreeAffiliation, TreeCharacter } from '../../../shared/types'
import { ArrowDownIcon, KeyboardArrowRightIcon } from './icons'

const same = (a: LibraryNode, b: LibraryNode): boolean =>
  a.type === b.type && ('id' in a ? a.id : 0) === ('id' in b ? b.id : 0)

export default function Tree(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const node = useStore((s) => s.filter.node)
  const setNode = useStore((s) => s.setNode)
  const [closed, setClosed] = useKept<Set<number>>('tree.closed', new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; g: { id: number; name: string } | null } | null>(null)
  const showToast = useStore((s) => s.showToast)

  // count (shown): the second number is under the rating filter, when one is set.
  const item = (n: LibraryNode, label: string, count: number | null, shown?: number, extra = '', pad?: number): JSX.Element => (
    <button
      className={`tree-item ${extra} ${same(n, node) ? 'on' : ''}`}
      style={pad === undefined ? undefined : { paddingLeft: pad }}
      title={label}
      onClick={() => setNode(n)}
    >
      <span className="tree-label">{label}</span>
      <span className="tree-count">
        {count === null ? '확인 전' : count.toLocaleString()}
        {shown !== undefined && <span className="tree-shown"> ({shown.toLocaleString()})</span>}
      </span>
    </button>
  )

  // Collapsible: games by id, 소속 by -id (one set for both).
  const toggle = (key: number, open: boolean): void =>
    setClosed((prev) => {
      const n = new Set(prev)
      if (open) n.add(key)
      else n.delete(key)
      return n
    })
  const caret = (key: number, open: boolean): JSX.Element => (
    <button className="tree-caret" title={open ? '접기' : '펼치기'} onClick={() => toggle(key, open)}>
      {open ? <ArrowDownIcon /> : <KeyboardArrowRightIcon />}
    </button>
  )
  const charItems = (list: TreeCharacter[], depth: number): JSX.Element[] =>
    list.map((ch) => (
      <div key={ch.id}>
        {item({ type: 'character', id: ch.id }, ch.name, ch.count, ch.shown, 'char', 34 + depth * 16)}
        {ch.children?.map((v) => (
          <div key={v.id}>{item({ type: 'character', id: v.id }, v.name, v.count, v.shown, 'variant', 52 + depth * 16)}</div>
        ))}
      </div>
    ))
  // 소속 → its sub-소속, then its characters.
  const affItems = (list: TreeAffiliation[], depth: number): JSX.Element[] =>
    list.map((a) => {
      const open = !closed.has(-a.id)
      return (
        <div key={`a${a.id}`}>
          <div className="tree-row" style={{ paddingLeft: depth * 16 }}>
            {caret(-a.id, open)}
            {item({ type: 'affiliation', id: a.id }, a.name, a.count, a.shown, 'aff')}
          </div>
          {open && (
            <>
              {affItems(a.children, depth + 1)}
              {charItems(a.characters, depth + 1)}
            </>
          )}
        </div>
      )
    })

  if (!tree) return <aside className="tree" />
  const c = tree.counts
  const f = tree.shown
  return (
    <aside className="tree">
      {item({ type: 'all' }, '전체', c.all, f?.all)}
      {item({ type: 'favorite' }, '즐겨찾기', c.favorite, f?.favorite, 'fav')}
      {tree.groups.map((g) => (
        <div key={`g${g.id}`} onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, g }))}>
          {item({ type: 'group', id: g.id }, g.name, g.count, g.shown, 'group')}
        </div>
      ))}
      <button className="tree-item add" onClick={() => useStore.getState().setGroupDialog([])}>
        <span className="tree-label">
          <AddIcon /> 새 그룹
        </span>
      </button>
      {menu?.g && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: '이름 변경', icon: <EditIcon />, onClick: () => useStore.getState().setRenameGroup(menu.g) },
            {
              label: '그룹 삭제 (그림은 그대로)',
              icon: <DeleteIcon />,
              onClick: () =>
                void window.api.deleteGroup(menu.g!.id).then(() => {
                  if (node.type === 'group' && node.id === menu.g!.id) setNode({ type: 'all' })
                  showToast({ ok: true, message: `그룹 "${menu.g!.name}" 삭제 · Ctrl+Z로 되돌리기` })
                })
            }
          ]}
        />
      )}
      <div className="tree-sep" />
      {tree.series.length === 0 && <div className="tree-empty">아직 분류된 캐릭터가 없습니다.</div>}
      {tree.series.map((s) => {
        const open = !closed.has(s.id)
        return (
          <div key={s.id} className="tree-group">
            <div className="tree-row">
              {caret(s.id, open)}
              {item({ type: 'series', id: s.id }, s.name, s.count, s.shown, 'series')}
            </div>
            {open && (
              <>
                {affItems(s.affiliations, 1)}
                {charItems(s.characters, 0)}
              </>
            )}
          </div>
        )
      })}
      <div className="tree-sep" />
      {item({ type: 'pending' }, '캐릭터 검토', c.pending, f?.pending)}
      {item({ type: 'ratingReview' }, '등급 확인', c.ratingReview, f?.ratingReview)}
      {item({ type: 'unknown' }, '미확인', c.unknown, f?.unknown)}
      {item({ type: 'other' }, '캐릭터 아닌 그림', c.other, f?.other)}
      {item({ type: 'unclassified' }, '분류 전', c.unclassified, f?.unclassified)}
      <div className="tree-sep" />
      {item({ type: 'dups' }, '중복 의심', tree.dups)}
      {item({ type: 'setAside' }, '따로 둔 중복', c.setAside, f?.setAside)}
    </aside>
  )
}

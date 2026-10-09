// Left tree: 게임 → 캐릭터 with image counts, plus the status nodes.
import type { JSX } from 'react'
import { useStore } from '../store'
import { useKept } from '../keep'
import { useEffect, useState } from 'react'
import ContextMenu from './ContextMenu'
import { AddIcon, ContentCopyIcon, DeleteIcon, EditIcon, PersonOffIcon, RestartIcon } from './icons'
import { copyText, setIgnored } from '../collect'
import type { LibraryNode, LibraryTree, TreeAffiliation, TreeCharacter } from '../../../shared/types'
import { ArrowDownIcon, KeyboardArrowRightIcon } from './icons'

// Selectors must not return a fresh [] each call (endless re-render).
const NO_TAGS: string[] = []

const same = (a: LibraryNode, b: LibraryNode): boolean =>
  a.type === b.type && ('id' in a ? a.id : 0) === ('id' in b ? b.id : 0)
const nodeKey = (n: LibraryNode): string => `${n.type}:${'id' in n ? n.id : ''}`

// Collapse keys (games by id, 소속 by -id) above a node, or null if absent.
function ancestors(tree: LibraryTree, n: LibraryNode): number[] | null {
  const inChars = (list: TreeCharacter[]): boolean => list.some((c) => (n.type === 'character' && c.id === n.id) || inChars(c.children ?? []))
  const inAffs = (list: TreeAffiliation[], path: number[]): number[] | null => {
    for (const a of list) {
      if (n.type === 'affiliation' && a.id === n.id) return path
      const p = [...path, -a.id]
      const sub = inAffs(a.children, p)
      if (sub) return sub
      if (inChars(a.characters)) return p
    }
    return null
  }
  for (const s of tree.series) {
    if (n.type === 'series' && s.id === n.id) return []
    const p = inAffs(s.affiliations, [s.id])
    if (p) return p
    if (inChars(s.characters)) return [s.id]
  }
  return n.type === 'group' ? [] : null
}

export default function Tree(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const node = useStore((s) => s.filter.node)
  const setNode = useStore((s) => s.setNode)
  const [closed, setClosed] = useKept<Set<number>>('tree.closed', new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; g: { id: number; name: string } | null } | null>(null)
  // right-click on a character (or a 무시한 캐릭터 row)
  const [charMenu, setCharMenu] = useState<{ x: number; y: number; name: string; tag: string | null } | null>(null)
  const ignoredTags = useStore((s) => s.settings?.ignoredCharacterTags) ?? NO_TAGS
  const openCharMenu = (e: React.MouseEvent, name: string, tag: string | null | undefined): void => {
    e.preventDefault()
    setCharMenu({ x: e.clientX, y: e.clientY, name, tag: tag ?? null })
  }
  const showToast = useStore((s) => s.showToast)

  // Search pick → open the collapsed levels above it, then scroll to it and
  // flash it (the same pulse as the 조직도 search).
  const reveal = useStore((s) => s.treeReveal)
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null)
  useEffect(() => {
    if (!reveal || !tree) return
    const up = ancestors(tree, reveal.node)
    if (!up) return
    if (up.some((k) => closed.has(k)))
      setClosed((prev) => {
        const nx = new Set(prev)
        for (const k of up) nx.delete(k)
        return nx
      })
    setFlash({ key: nodeKey(reveal.node), n: reveal.n })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.n, tree])
  useEffect(() => {
    if (!flash) return
    const el = document.querySelector<HTMLElement>(`.tree [data-node="${flash.key}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('tree-flash')
    void el.offsetWidth // restart when the same item is picked again
    el.classList.add('tree-flash')
    const t = window.setTimeout(() => el.classList.remove('tree-flash'), 1600)
    setFlash(null)
    return () => window.clearTimeout(t)
  }, [flash, closed])

  // count (shown): the second number is under the rating filter, when one is set.
  const item = (n: LibraryNode, label: string, count: number | null, shown?: number, extra = '', pad?: number): JSX.Element => (
    <button
      className={`tree-item ${extra} ${same(n, node) ? 'on' : ''}`}
      // --pad: the divider under the item starts where its text starts
      style={pad === undefined ? undefined : ({ paddingLeft: pad, '--pad': `${pad}px` } as React.CSSProperties)}
      title={label}
      data-node={nodeKey(n)}
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
        <div onContextMenu={(e) => openCharMenu(e, ch.name, ch.tag)}>
          {item({ type: 'character', id: ch.id }, ch.name, ch.count, ch.shown, 'char', 34 + depth * 16)}
        </div>
        {ch.children?.map((v) => (
          <div key={v.id} onContextMenu={(e) => openCharMenu(e, v.name, v.tag)}>
            {item({ type: 'character', id: v.id }, v.name, v.count, v.shown, 'variant', 52 + depth * 16)}
          </div>
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
      {tree.ignored.length > 0 && (
        <>
          <div className="tree-sep" />
          <div className="tree-row">
            {caret(-1e9, !closed.has(-1e9))}
            <span className="tree-head-label">무시한 캐릭터 {tree.ignored.length}</span>
          </div>
          {!closed.has(-1e9) &&
            tree.ignored.map((g) => (
              <div
                key={g.tag}
                className="tree-item ignored"
                style={{ paddingLeft: 34 }}
                title={`${g.tag} · 우클릭으로 무시 해제`}
                onContextMenu={(e) => openCharMenu(e, g.name, g.tag)}
              >
                <span className="tree-label">{g.name}</span>
                {g.series && <span className="tree-count">{g.series}</span>}
              </div>
            ))}
        </>
      )}
      {charMenu && (
        <ContextMenu
          x={charMenu.x}
          y={charMenu.y}
          onClose={() => setCharMenu(null)}
          items={[
            { label: '캐릭터 이름 복사', icon: <ContentCopyIcon />, onClick: () => void copyText(charMenu.name, '이름 복사') },
            {
              label: charMenu.tag ? `캐릭터 태그 복사 (${charMenu.tag})` : '캐릭터 태그 복사 (태그 없음)',
              icon: <ContentCopyIcon />,
              disabled: !charMenu.tag,
              onClick: () => void copyText(charMenu.tag!, '태그 복사')
            },
            charMenu.tag && ignoredTags.includes(charMenu.tag)
              ? { label: '무시 해제', icon: <RestartIcon />, separator: true, onClick: () => void setIgnored(charMenu.tag!, false, charMenu.name) }
              : {
                  label: charMenu.tag ? '이 캐릭터 무시 (캐릭터로 치지 않기)' : '무시 (태그 없는 캐릭터는 무시할 수 없습니다)',
                  icon: <PersonOffIcon />,
                  separator: true,
                  disabled: !charMenu.tag,
                  onClick: () => void setIgnored(charMenu.tag!, true, charMenu.name)
                }
          ]}
        />
      )}
    </aside>
  )
}

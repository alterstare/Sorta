// Library search with autocomplete: games, 소속, characters, groups and the
// tree's lists (단체 사진, 미확인 …). Picking one opens that node (the tree
// scrolls to it and flashes); the last option — or Enter with nothing
// suggested — is the plain text search over names / file names.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { LibraryNode, LibraryTree, TreeAffiliation, TreeCharacter } from '../../../shared/types'
import { CloseIcon, FolderIcon, PersonIcon, SearchIcon } from './icons'

type Hit = { node: LibraryNode; name: string; path: string; count: number; kind: 'series' | 'aff' | 'char' | 'group' | 'list' }

function collect(tree: LibraryTree): Hit[] {
  const out: Hit[] = []
  const c = tree.counts
  const lists: [LibraryNode, string, number | null][] = [
    [{ type: 'favorite' }, '즐겨찾기', c.favorite],
    [{ type: 'pending' }, '캐릭터 검토', c.pending],
    [{ type: 'ratingReview' }, '등급 확인', c.ratingReview],
    [{ type: 'unknown' }, '미확인', c.unknown],
    [{ type: 'groupShot' }, '단체 사진', c.groupShot],
    [{ type: 'original' }, '오리지널', c.original],
    [{ type: 'other' }, '기타', c.other],
    [{ type: 'unclassified' }, '분류 전', c.unclassified],
    [{ type: 'dups' }, '중복 의심', tree.dups],
    [{ type: 'setAside' }, '따로 둔 중복', c.setAside]
  ]
  for (const [node, name, n] of lists) if (n) out.push({ node, name, path: '목록', count: n, kind: 'list' })
  for (const g of tree.groups) out.push({ node: { type: 'group', id: g.id }, name: g.name, path: '그룹', count: g.count, kind: 'group' })
  for (const s of tree.series) {
    out.push({ node: { type: 'series', id: s.id }, name: s.name, path: '게임', count: s.count, kind: 'series' })
    if (s.groupShots) out.push({ node: { type: 'groupShot', id: s.id }, name: '단체 사진', path: s.name, count: s.groupShots, kind: 'list' })
    const chars = (list: TreeCharacter[], path: string): void => {
      for (const c of list) {
        out.push({ node: { type: 'character', id: c.id }, name: c.name, path, count: c.count, kind: 'char' })
        if (c.children) chars(c.children, `${path} › ${c.name}`)
      }
    }
    const affs = (list: TreeAffiliation[], path: string): void => {
      for (const a of list) {
        out.push({ node: { type: 'affiliation', id: a.id }, name: a.name, path, count: a.count, kind: 'aff' })
        affs(a.children, `${path} › ${a.name}`)
        chars(a.characters, `${path} › ${a.name}`)
      }
    }
    affs(s.affiliations, s.name)
    chars(s.characters, s.name)
  }
  return out
}

const KIND_ORDER: Record<Hit['kind'], number> = { series: 0, aff: 1, char: 2, group: 3, list: 4 }

export default function LibrarySearch(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const filterQ = useStore((s) => s.filter.q)
  const setQuery = useStore((s) => s.setQuery)
  const goToNode = useStore((s) => s.goToNode)
  const [q, setQ] = useState(filterQ)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const all = useMemo(() => (tree ? collect(tree) : []), [tree])
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    const score = (h: Hit): number => {
      const n = h.name.toLowerCase()
      return n === t ? 0 : n.startsWith(t) ? 1 : n.includes(t) ? 2 : -1
    }
    return all
      .map((h) => ({ h, s: score(h) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || KIND_ORDER[a.h.kind] - KIND_ORDER[b.h.kind] || b.h.count - a.h.count)
      .slice(0, 30)
      .map((x) => x.h)
  }, [q, all])
  const options = hits.length + 1 // + the text search
  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelectorAll('.picker-opt')[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (i: number): void => {
    setOpen(false)
    const h = hits[i]
    if (!h) return setQuery(q)
    setQ('')
    goToNode(h.node)
  }

  return (
    <div className="picker lib-search">
      <div className="search-box">
        <SearchIcon />
        <input
          value={q}
          placeholder="캐릭터 · 게임 · 파일명 검색"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setSel((i) => Math.min(options - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') pick(open ? sel : hits.length)
            else if (e.key === 'Escape') setOpen(false)
          }}
        />
        {(q || filterQ) && (
          <button
            className="search-clear"
            title="지우기"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQ('')
              setQuery('')
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      {open && q.trim() && (
        <div className="picker-list" ref={listRef}>
          {hits.map((h, i) => (
            <button
              key={`${h.node.type}${'id' in h.node ? (h.node.id ?? '') : ''}`}
              className={`picker-opt ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => e.preventDefault()} // keep focus: the blur would close the list before the click
              onClick={() => pick(i)}
            >
              {h.kind === 'char' ? <PersonIcon /> : h.kind === 'group' ? <FolderIcon /> : null}
              <span className="picker-name">{h.name}</span>
              <span className="picker-series">{h.path}</span>
              <span className="picker-n">{h.count.toLocaleString()}</span>
            </button>
          ))}
          <button
            className={`picker-opt new ${sel === hits.length ? 'sel' : ''}`}
            onMouseEnter={() => setSel(hits.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(hits.length)}
          >
            <SearchIcon />
            <span className="picker-name">이름 · 파일명에 “{q.trim()}” 들어간 그림 찾기</span>
          </button>
        </div>
      )}
    </div>
  )
}

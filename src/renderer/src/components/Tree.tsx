// Left tree: 게임 → 캐릭터 with image counts, plus the status nodes.
import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { LibraryNode } from '../../../shared/types'
import { ArrowDownIcon, KeyboardArrowRightIcon } from './icons'

const same = (a: LibraryNode, b: LibraryNode): boolean =>
  a.type === b.type && ('id' in a ? a.id : 0) === ('id' in b ? b.id : 0)

export default function Tree(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const node = useStore((s) => s.filter.node)
  const setNode = useStore((s) => s.setNode)
  const [closed, setClosed] = useState<Set<number>>(new Set())

  const item = (n: LibraryNode, label: string, count: number, extra = ''): JSX.Element => (
    <button className={`tree-item ${extra} ${same(n, node) ? 'on' : ''}`} onClick={() => setNode(n)}>
      <span className="tree-label">{label}</span>
      <span className="tree-count">{count}</span>
    </button>
  )

  if (!tree) return <aside className="tree" />
  const c = tree.counts
  return (
    <aside className="tree">
      {item({ type: 'all' }, '전체', c.all)}
      <div className="tree-sep" />
      {tree.series.length === 0 && <div className="tree-empty">아직 분류된 캐릭터가 없습니다.</div>}
      {tree.series.map((s) => {
        const open = !closed.has(s.id)
        return (
          <div key={s.id} className="tree-group">
            <div className="tree-row">
              <button
                className="tree-caret"
                title={open ? '접기' : '펼치기'}
                onClick={() =>
                  setClosed((prev) => {
                    const n = new Set(prev)
                    if (open) n.add(s.id)
                    else n.delete(s.id)
                    return n
                  })
                }
              >
                {open ? <ArrowDownIcon /> : <KeyboardArrowRightIcon />}
              </button>
              {item({ type: 'series', id: s.id }, s.name, s.count, 'series')}
            </div>
            {open && s.characters.map((ch) => <div key={ch.id}>{item({ type: 'character', id: ch.id }, ch.name, ch.count, 'char')}</div>)}
          </div>
        )
      })}
      <div className="tree-sep" />
      {item({ type: 'pending' }, '캐릭터 검토', c.pending)}
      {item({ type: 'ratingReview' }, '등급 확인', c.ratingReview)}
      {item({ type: 'unknown' }, '미확인', c.unknown)}
      {item({ type: 'other' }, '캐릭터 아님', c.other)}
      {item({ type: 'unclassified' }, '분류 전', c.unclassified)}
    </aside>
  )
}

// 검토 건너뛰기: a skipped picture goes to the back of the queue, after the
// ones not skipped, in the order skipped. Remembered per kind across restarts
// (this device only); pictures no longer in the queue drop out of the list.
// Same file in Sorta 모바일.
const key = (kind: string): string => `sorta.review.skipped.${kind}`

function load(kind: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(kind)) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
  } catch {
    return []
  }
}

function save(kind: string, ids: number[]): void {
  try {
    localStorage.setItem(key(kind), JSON.stringify(ids))
  } catch {
    // storage unavailable: the order lasts this session only
  }
}

// The queue with the skipped pictures moved to the back.
export function orderQueue<T extends { id: number }>(kind: string, items: T[]): T[] {
  const ids = new Set(items.map((i) => i.id))
  const all = load(kind)
  const skipped = all.filter((id) => ids.has(id))
  if (skipped.length !== all.length) save(kind, skipped)
  const at = new Map(skipped.map((id, i) => [id, i]))
  return [...items.filter((i) => !at.has(i.id)), ...skipped.map((id) => items.find((i) => i.id === id)!)]
}

// Skip `id`: to the very back (again, if it was skipped before).
export function skipItem<T extends { id: number }>(kind: string, items: T[], id: number): T[] {
  save(kind, [...load(kind).filter((x) => x !== id), id])
  return orderQueue(kind, items)
}

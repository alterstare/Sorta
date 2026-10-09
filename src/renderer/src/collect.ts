// Collection actions shared by the grid, the list, the viewer and the
// right-click menu. Each is one undo step (core side); results show as toasts.
import { useStore } from './store'
import type { ImageItem } from '../../shared/types'

const toast = (ok: boolean, message: string): void => useStore.getState().showToast({ ok, message })
const err = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export async function toggleFavorite(imgs: ImageItem[]): Promise<void> {
  const on = !imgs.every((i) => i.favorite)
  await window.api.setFavorite(
    imgs.map((i) => i.id),
    on
  )
  if (imgs.length > 1) toast(true, `${imgs.length}장 즐겨찾기 ${on ? '추가' : '해제'} · Ctrl+Z로 되돌리기`)
}

export async function setStars(imgs: ImageItem[], n: number): Promise<void> {
  await window.api.setStars(
    imgs.map((i) => i.id),
    n
  )
}

export async function toggleGroup(imgs: ImageItem[], g: { id: number; name: string }): Promise<void> {
  const on = !imgs.every((i) => i.groups.includes(g.id))
  try {
    await window.api.setGroupMembership(
      imgs.map((i) => i.id),
      g.id,
      on
    )
    toast(true, `${imgs.length}장 그룹 "${g.name}"${on ? '에 추가' : '에서 빼기'} · Ctrl+Z로 되돌리기`)
  } catch (e) {
    toast(false, err(e))
  }
}

export async function createGroup(name: string, ids: number[]): Promise<boolean> {
  try {
    await window.api.createGroup(name, ids)
    toast(true, `그룹 "${name.trim()}" 만들기${ids.length ? ` · ${ids.length}장 추가` : ''}`)
    return true
  } catch (e) {
    toast(false, err(e))
    return false
  }
}

// Character names only (no game), several joined with ", ".
export function characterNames(imgs: ImageItem[]): string {
  const names: string[] = []
  for (const i of imgs) for (const c of i.characters) if (c.name && (c.status === 'auto' || c.status === 'confirmed') && !names.includes(c.name)) names.push(c.name)
  return names.join(', ')
}

export async function copyNames(imgs: ImageItem[]): Promise<void> {
  const s = characterNames(imgs)
  if (!s) return toast(false, '확정된 캐릭터가 없습니다')
  await navigator.clipboard.writeText(s)
  toast(true, `복사: ${s}`)
}

// Danbooru tags of the confirmed characters (for the 무시 목록 etc.), ", "-joined.
export function characterTags(imgs: ImageItem[]): string {
  const tags: string[] = []
  for (const i of imgs) for (const c of i.characters) if (c.tag && (c.status === 'auto' || c.status === 'confirmed') && !tags.includes(c.tag)) tags.push(c.tag)
  return tags.join(', ')
}

export async function copyText(s: string, what = '복사'): Promise<void> {
  await navigator.clipboard.writeText(s)
  toast(true, `${what}: ${s}`)
}

// 무시할 캐릭터 태그: add / remove one (re-applies the decisions, no model run).
export async function setIgnored(tag: string, on: boolean, name = tag): Promise<void> {
  const st = useStore.getState()
  const cur = st.settings?.ignoredCharacterTags ?? []
  if (on === cur.includes(tag)) return
  await st.saveSettings({ ignoredCharacterTags: on ? [...cur, tag] : cur.filter((t) => t !== tag) })
  toast(true, on ? `${name}: 이제 캐릭터로 치지 않습니다 (분류를 다시 적용합니다)` : `${name}: 무시를 해제했습니다 (분류를 다시 적용합니다)`)
}

export async function copyImage(img: ImageItem): Promise<void> {
  const ok = await window.api.copyImage(img.path)
  toast(ok, ok ? '이미지를 복사했습니다' : '이미지를 복사하지 못했습니다')
}

// 라이브러리: left tree (게임 → 캐릭터) + Explorer-style toolbar (분류 실행 ·
// 분류 · 정렬 · 보기 · 마스킹 · 격자/목록 · 순서 … 검색) + thumbnails.
import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { blocking, useStore } from '../store'
import type { RatingPick, SafeMode, SortKey } from '../../../shared/types'
import {
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FilterIcon,
  FolderIcon,
  FolderOpenIcon,
  GridViewIcon,
  ListIcon,
  PlayIcon,
  RefreshIcon,
  SettingsIcon,
  SortIcon,
  VisibilityIcon
} from './icons'
import Tree from './Tree'
import LibrarySearch from './LibrarySearch'
import ThumbGrid, { safeMode } from './ThumbGrid'
import type { ThumbSize } from './ThumbGrid'
import Viewer from './Viewer'
import SelectionBar from './SelectionBar'
import DropMenu, { MenuOption, MenuSection } from './DropMenu'
import DupView from './DupView'
import Setup from './Setup'

const ALL: RatingPick[] = ['general', 'sensitive', 'r18']
const RATING_NAMES: [RatingPick, string][] = [
  ['general', '일반'],
  ['sensitive', '민감'],
  ['r18', 'R-18']
]
const SORTS: [SortKey, string][] = [
  ['name', '이름'],
  ['date', '날짜'],
  ['type', '유형'],
  ['size', '크기'],
  ['random', '무작위']
]
const SIZES: [ThumbSize, string][] = [
  ['s', '작은 아이콘'],
  ['m', '보통 아이콘'],
  ['l', '큰 아이콘']
]
const SAFE: [SafeMode, string][] = [
  ['show', '표시'],
  ['blur', '블러'],
  ['hide', '숨기기']
]

export default function Library(): JSX.Element {
  const { settings, saveSettings, setView, filter, setRatings, setSort, setDir, setGroupFilter, reshuffle, images, tree, showToast, jobs } = useStore()
  // 그룹 filter: checked groups only (none checked = every picture); deleted groups drop out.
  const groups = tree?.groups ?? []
  const selectedCount = useStore((s) => s.selected.size)
  const groupSel = (filter.groups ?? []).filter((id) => groups.some((g) => g.id === id))
  const groupLabel = !groupSel.length
    ? '그룹: 전체'
    : groupSel.length === 1
      ? `그룹: ${groups.find((g) => g.id === groupSel[0])?.name}`
      : `그룹: ${groupSel.length}개`
  const [busy, setBusy] = useState(false)
  // "숨기기" masking drops those images from the list (and the viewer).
  const items = useMemo(() => images.filter((i) => safeMode(i, settings) !== 'hide'), [images, settings])
  const running = blocking(jobs)

  // 분류 checkboxes: 전체 ticks all three (remembering the selection before);
  // un-ticking 전체 brings that selection back (none remembered → 일반 only).
  const ratings = filter.ratings
  const isAll = ALL.every((r) => ratings.includes(r))
  const toggleAll = (): void => {
    if (!isAll) setRatings([...ALL], ratings)
    else setRatings(settings?.libRatingsPrev?.length && !ALL.every((r) => settings.libRatingsPrev!.includes(r)) ? settings.libRatingsPrev : ['general'], null)
  }
  const toggleRating = (r: RatingPick): void => {
    const next = ratings.includes(r) ? ratings.filter((x) => x !== r) : ALL.filter((x) => x === r || ratings.includes(x))
    if (next.length) setRatings(next)
  }
  const ratingLabel = isAll ? '전체' : RATING_NAMES.filter(([r]) => ratings.includes(r)).map(([, l]) => l).join(' · ')

  const classify = async (): Promise<void> => {
    setBusy(true)
    try {
      showToast(await window.api.runImport())
    } finally {
      setBusy(false)
    }
  }

  const empty = tree && tree.counts.all === 0
  // 처음 쓸 때 (no model yet, or nothing imported and no folder): the setup steps.
  const models = useStore((s) => s.models)
  const needSetup = models.length > 0 && (!models.find((m) => m.id === 'wd')?.installed || (!!empty && !settings?.sourceDirs.length))
  if (needSetup) return <Setup />
  return (
    <div className="library">
      <Tree />
      <section className="grid-pane">
        {/* top row: action · search */}
        <div className="toolbar top">
          <div className="flat-group">
            <button
              className="mini primary"
              disabled={busy || running || !settings?.sourceDirs.length}
              title="원본 폴더에서 새 그림을 가져오고 분류합니다"
              onClick={() => void classify()}
            >
              <PlayIcon />
              분류 실행
            </button>
            <button
              className="mini"
              title={filter.sort === 'random' ? '무작위 순서를 새로 섞습니다' : '목록을 지금 정렬 기준으로 다시 정렬합니다'}
              onClick={() => reshuffle()}
            >
              <RefreshIcon />
              재정렬
            </button>
          </div>
          <span className="spacer" />
          <LibrarySearch />
        </div>
        {/* bottom row: 격자/목록 · 차순 | 분류 · 그룹 · 정렬 · 보기 · 마스킹 … count */}
        <div className="toolbar bottom">
          <div className="flat-group">
            <button
              className="mini icon"
              title={settings?.libLayout === 'list' ? '목록형 (누르면 격자형)' : '격자형 (누르면 목록형)'}
              onClick={() => void saveSettings({ libLayout: settings?.libLayout === 'list' ? 'grid' : 'list' })}
            >
              {settings?.libLayout === 'list' ? <ListIcon /> : <GridViewIcon />}
            </button>
            <button
              className="mini icon"
              title={filter.dir === 'asc' ? '오름차순 (누르면 내림차순)' : '내림차순 (누르면 오름차순)'}
              onClick={() => setDir(filter.dir === 'asc' ? 'desc' : 'asc')}
            >
              {filter.dir === 'asc' ? <ArrowUpIcon /> : <ArrowDownIcon />}
            </button>
          </div>
          <div className="flat-group">
            <DropMenu icon={<FilterIcon />} label={`분류: ${ratingLabel}`}>
              {() => (
                <>
                  <MenuOption box on={isAll} onClick={toggleAll}>
                    전체
                  </MenuOption>
                  <div className="menu-line" />
                  {RATING_NAMES.map(([r, l]) => (
                    <MenuOption key={r} box on={ratings.includes(r)} onClick={() => toggleRating(r)}>
                      {l}
                    </MenuOption>
                  ))}
                </>
              )}
            </DropMenu>
            <DropMenu icon={<FolderIcon />} label={groupLabel}>
              {(close) => (
                <>
                  <MenuOption box on={!groupSel.length} onClick={() => setGroupFilter([])}>
                    모든 그림
                  </MenuOption>
                  <div className="menu-line" />
                  {groups.length === 0 && <div className="menu-sec">아직 그룹이 없습니다.</div>}
                  {groups.map((g) => (
                    <MenuOption
                      key={g.id}
                      box
                      on={groupSel.includes(g.id)}
                      onClick={() => setGroupFilter(groupSel.includes(g.id) ? groupSel.filter((x) => x !== g.id) : [...groupSel, g.id])}
                    >
                      {g.name}
                      <span className="dim"> {g.count.toLocaleString()}</span>
                    </MenuOption>
                  ))}
                  <div className="menu-line" />
                  {/* selected pictures (if any) go straight into the new group */}
                  <button
                    className="menu-opt new"
                    onClick={() => {
                      close()
                      useStore.getState().setGroupDialog([...useStore.getState().selected])
                    }}
                  >
                    <AddIcon />
                    {selectedCount ? `새 그룹 (선택한 ${selectedCount}장 넣기)` : '새 그룹'}
                  </button>
                </>
              )}
            </DropMenu>
            <DropMenu icon={<SortIcon />} label={`정렬: ${SORTS.find(([k]) => k === filter.sort)?.[1] ?? ''}`}>
              {(close) =>
                SORTS.map(([k, l]) => (
                  <MenuOption key={k} on={filter.sort === k} onClick={() => (setSort(k), close())}>
                    {l}
                  </MenuOption>
                ))
              }
            </DropMenu>
            <DropMenu icon={<GridViewIcon />} label="보기">
              {(close) =>
                SIZES.map(([k, l]) => (
                  <MenuOption key={k} on={settings?.thumbSize === k} onClick={() => (void saveSettings({ thumbSize: k }), close())}>
                    {l}
                  </MenuOption>
                ))
              }
            </DropMenu>
            <DropMenu icon={<VisibilityIcon />} label="마스킹">
              {() =>
                (
                  [
                    ['safeR18', 'R-18'],
                    ['safeSensitive', '민감']
                  ] as const
                ).map(([key, title]) => (
                  <div key={key}>
                    <MenuSection title={title} />
                    {SAFE.map(([v, l]) => (
                      <MenuOption key={v} on={settings?.[key] === v} onClick={() => void saveSettings({ [key]: v })}>
                        {l}
                      </MenuOption>
                    ))}
                  </div>
                ))
              }
            </DropMenu>
          </div>
          <span className="tb-count">{items.length.toLocaleString()}장</span>
        </div>
        <SelectionBar allIds={items.map((i) => i.id)} />
        {filter.node.type === 'dups' ? (
          <DupView />
        ) : empty ? (
          <div className="grid">
            <div className="empty">
              <FolderOpenIcon />
              <p>설정에서 원본 폴더를 등록하고 가져오기를 실행하면 이미지가 여기에 표시됩니다.</p>
              <button className="btn" onClick={() => setView('settings')}>
                <SettingsIcon />
                설정 열기
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="grid">
            <div className="empty">
              <p>조건에 맞는 이미지가 없습니다.</p>
            </div>
          </div>
        ) : (
          <ThumbGrid items={items} />
        )}
      </section>
      <Viewer items={items} />
    </div>
  )
}

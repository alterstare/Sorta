import { useEffect, useState } from 'react'
import { embedded, followHostTheme, onHostSettings, postJob, postView } from './embed'
import type { SortaStatus } from '../../shared/ipc'
import logo from './assets/logo.png'
import type { JSX } from 'react'
import { useStore } from './store'
import type { View } from './store'
import { PhotoLibraryIcon, FactCheckIcon, HelpIcon, PersonIcon, SettingsIcon, CloseIcon } from './components/icons'
import Library from './components/Library'
import UnknownView from './components/UnknownView'
import ManageView from './components/ManageView'
import OrgView from './components/OrgView'
import Review from './components/Review'
import LearnView from './components/LearnView'
import SettingsView from './components/SettingsView'
import ProgressBar from './components/ProgressBar'
import { NewGroupDialog } from './components/ImageMenu'

const NAV: [View, string, typeof PhotoLibraryIcon][] = [
  ['library', '라이브러리', PhotoLibraryIcon],
  ['review', '검토', FactCheckIcon],
  ['unknown', '미확인', HelpIcon],
  ['characters', '캐릭터', PersonIcon]
]

// 캐릭터: 관리 / 학습 tabs (shown next to the page title).
function CharactersView(): JSX.Element {
  const tab = useStore((s) => s.charTab)
  const setTab = useStore((s) => s.setCharTab)
  const tabs = (
    <div className="flat-group">
      {(
        [
          ['manage', '관리'],
          ['org', '소속'],
          ['learn', '학습']
        ] as const
      ).map(([k, label]) => (
        <button key={k} className={`mini ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
          {label}
        </button>
      ))}
    </div>
  )
  if (tab === 'manage') return <ManageView tabs={tabs} />
  return tab === 'org' ? <OrgView tabs={tabs} /> : <LearnView tabs={tabs} />
}

// The data folder is shared with the other app (standalone Sorta / Halftone):
// while that one has it open, show who and offer a retry.
export default function App(): JSX.Element | null {
  const [st, setSt] = useState<SortaStatus | null>(null)
  useEffect(() => {
    void window.api.status().then(setSt)
  }, [])
  if (!st) return null
  if (st.newerData)
    return (
      <div className="locked">
        <img className="locked-logo" src={logo} alt="" />
        <h2>더 새 버전의 Sorta에서 만든 데이터입니다</h2>
        <p>
          Sorta 독립 앱과 Halftone은 같은 분류 데이터를 함께 씁니다. 다른 쪽이 더 새 버전이라 이 버전에서는 데이터를 열지 않습니다.{' '}
          {embedded ? 'Halftone을 업데이트한 뒤 다시 여세요.' : 'Sorta를 업데이트한 뒤 다시 여세요.'}
        </p>
      </div>
    )
  if (!st.ready)
    return (
      <div className="locked">
        <img className="locked-logo" src={logo} alt="" />
        <h2>{st.lockedBy ?? '다른 앱'}에서 Sorta 데이터를 쓰고 있습니다</h2>
        <p>Sorta 독립 앱과 Halftone은 같은 분류 데이터를 함께 씁니다. {st.lockedBy ?? '다른 앱'}을(를) 닫은 뒤 다시 시도하세요.</p>
        <button className="btn primary" onClick={() => void window.api.retryLock().then(setSt)}>
          다시 시도
        </button>
      </div>
    )
  return <Main />
}

function Main(): JSX.Element {
  const { view, setView, settings, load, onProgress, refreshLibrary, refreshModels, toast, dismissToast } = useStore()

  useEffect(() => {
    void load()
    void window.api.start() // watch folders + start-up jobs (once)
    const offProgress = window.api.onProgress((e) => (onProgress(e), postJob(e)))
    const offToast = window.api.onToast((t) => useStore.getState().showToast(t))
    const offUpdate = window.api.onUpdateStatus((update) => useStore.setState({ update }))
    const offChanged = window.api.onLibraryChanged(() => {
      void refreshLibrary()
      void refreshModels()
    })
    return () => {
      offProgress()
      offToast()
      offUpdate()
      offChanged()
    }
  }, [load, onProgress, refreshLibrary, refreshModels])

  const counts = useStore((s) => s.tree?.counts)
  const reviewCount = (counts?.pending ?? 0) + (counts?.ratingReview ?? 0)

  // Ctrl+Z anywhere (outside text fields) → undo the last decision.
  const undo = useStore((s) => s.undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  // Inside Halftone: its tab-bar settings button opens Sorta's settings.
  useEffect(() => onHostSettings(() => setView('settings')), [setView])
  useEffect(() => postView(view), [view])

  // Theme: Sorta's own setting, or — inside Halftone — the host's theme.
  useEffect(() => {
    if (embedded) return followHostTheme((t) => (document.documentElement.dataset.theme = t))
    if (settings) document.documentElement.dataset.theme = settings.theme
    return undefined
  }, [settings?.theme])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src={logo} alt="" draggable={false} />
          Sorta
        </div>
        <nav className="flat-group nav">
          {NAV.map(([v, label, Icon]) => (
            <button key={v} className={`mini ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
              <Icon />
              {label}
              {v === 'review' && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {/* inside Halftone this button lives in Halftone's tab bar */}
        {!embedded && (
          <button className={`icon-btn ${view === 'settings' ? 'on' : ''}`} title="설정" onClick={() => setView('settings')}>
            <SettingsIcon />
          </button>
        )}
      </header>
      <main className="body">
        {view === 'library' && <Library />}
        {view === 'review' && <Review />}
        {view === 'unknown' && <UnknownView />}
        {view === 'characters' && <CharactersView />}
        {view === 'settings' && <SettingsView />}
      </main>
      {/* inside Halftone, jobs show in Halftone's activity bar */}
      {!embedded && <ProgressBar />}
      <NewGroupDialog />
      {toast && (
        <div className={`toast ${toast.ok ? '' : 'err'}`}>
          <span>{toast.message}</span>
          <button className="toast-x" title="닫기" onClick={dismissToast}>
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  )
}

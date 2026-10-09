import { useEffect } from 'react'
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

export default function App(): JSX.Element {
  const { view, setView, settings, load, onProgress, refreshLibrary, refreshModels, toast, dismissToast } = useStore()

  useEffect(() => {
    void load()
    const offProgress = window.api.onProgress(onProgress)
    const offToast = window.api.onToast((t) => useStore.getState().showToast(t))
    const offChanged = window.api.onLibraryChanged(() => {
      void refreshLibrary()
      void refreshModels()
    })
    return () => {
      offProgress()
      offToast()
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

  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Sorta</div>
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
        <button className={`icon-btn ${view === 'settings' ? 'on' : ''}`} title="설정" onClick={() => setView('settings')}>
          <SettingsIcon />
        </button>
      </header>
      <main className="body">
        {view === 'library' && <Library />}
        {view === 'review' && <Review />}
        {view === 'unknown' && <UnknownView />}
        {view === 'characters' && <CharactersView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <ProgressBar />
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

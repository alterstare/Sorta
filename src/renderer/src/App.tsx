import { useEffect } from 'react'
import type { JSX } from 'react'
import { useStore } from './store'
import type { View } from './store'
import { PhotoLibraryIcon, FactCheckIcon, HelpIcon, PersonIcon, SettingsIcon } from './components/icons'
import Library from './components/Library'
import Placeholder from './components/Placeholder'
import SettingsView from './components/SettingsView'
import ProgressBar from './components/ProgressBar'

const NAV: [View, string, typeof PhotoLibraryIcon][] = [
  ['library', '라이브러리', PhotoLibraryIcon],
  ['review', '검토', FactCheckIcon],
  ['unknown', '미확인', HelpIcon],
  ['characters', '캐릭터', PersonIcon]
]

export default function App(): JSX.Element {
  const { view, setView, settings, load, onProgress } = useStore()

  useEffect(() => {
    void load()
    return window.api.onProgress(onProgress)
  }, [load, onProgress])

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
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <button
          className={`icon-btn ${view === 'settings' ? 'on' : ''}`}
          title="설정"
          onClick={() => setView('settings')}
        >
          <SettingsIcon />
        </button>
      </header>
      <main className="body">
        {view === 'library' && <Library />}
        {view === 'review' && <Placeholder title="검토 대기열" phase={2} />}
        {view === 'unknown' && <Placeholder title="미확인" phase={4} />}
        {view === 'characters' && <Placeholder title="캐릭터 관리" phase={4} />}
        {view === 'settings' && <SettingsView />}
      </main>
      <ProgressBar />
    </div>
  )
}

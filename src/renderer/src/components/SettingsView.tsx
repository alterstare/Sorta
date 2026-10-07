// 설정 — Phase 0: theme + read-only view of the stored thresholds and paths.
import type { JSX } from 'react'
import { useStore } from '../store'
import type { Thresholds } from '../../../shared/types'

const THRESHOLD_LABELS: [keyof Thresholds, string][] = [
  ['autoAccept', '자동 확정 점수'],
  ['margin', '1·2위 최소 차이'],
  ['reviewMin', '낮은 확신 기준'],
  ['candidateMin', '후보 표시 최소 점수'],
  ['r18Threshold', 'R-18 기준'],
  ['sensitiveThreshold', '민감 기준'],
  ['ratingMargin', '등급 경계 여유'],
  ['groupThreshold', '단체 폴더 인원']
]

export default function SettingsView(): JSX.Element {
  const { settings, info, saveSettings } = useStore()
  if (!settings) return <div className="page" />

  return (
    <div className="page settings">
      <h1>설정</h1>

      <section className="card">
        <h2>화면</h2>
        <div className="row">
          <div className="row-text">
            <div className="row-title">테마</div>
          </div>
          <div className="flat-group">
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} className={`mini ${settings.theme === t ? 'on' : ''}`} onClick={() => void saveSettings({ theme: t })}>
                {t === 'light' ? '라이트' : '다크'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>분류 기준</h2>
        {THRESHOLD_LABELS.map(([k, label]) => (
          <div className="row" key={k}>
            <div className="row-text">
              <div className="row-title">{label}</div>
            </div>
            <span className="value">{settings.thresholds[k]}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>데이터</h2>
        <div className="row">
          <div className="row-text">
            <div className="row-title">데이터 폴더</div>
            <div className="row-desc selectable">{info?.dataDir}</div>
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">DB 스키마 버전</div>
          </div>
          <span className="value">{info?.schemaVersion}</span>
        </div>
      </section>

      <div className="version">Sorta v{info?.version}</div>
    </div>
  )
}

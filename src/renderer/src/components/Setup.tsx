// 처음 쓸 때: shown instead of the library until the main model is installed
// and there is something to sort. Models are never bundled (Halftone or
// standalone): the user downloads them here, then adds a folder and starts.
import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { AddIcon, CheckIcon, DownloadIcon, PlayIcon, SettingsIcon } from './icons'
import logo from '../assets/logo.png'

const mb = (n: number): string => Math.round(n / 1048576).toLocaleString()

export default function Setup(): JSX.Element {
  const { models, settings, saveSettings, refreshModels, refreshLibrary, showToast, setView, jobs } = useStore()
  const [busy, setBusy] = useState<'model' | 'import' | null>(null)
  const tagger = models.find((m) => m.id === 'wd')
  const hasModel = !!tagger?.installed
  const dirs = settings?.sourceDirs ?? []
  // The model download's progress (bytes) while it runs.
  const dl = Object.values(jobs).find((j) => j.unit === 'bytes' && j.state === 'running')

  const getModel = async (): Promise<void> => {
    setBusy('model')
    try {
      showToast(await window.api.downloadModel('wd'))
    } finally {
      setBusy(null)
      void refreshModels()
    }
  }
  const addFolder = async (): Promise<void> => {
    const d = await window.api.pickFolder()
    if (d && !dirs.includes(d)) await saveSettings({ sourceDirs: [...dirs, d] })
  }
  const start = async (): Promise<void> => {
    setBusy('import')
    try {
      showToast(await window.api.runImport())
    } finally {
      setBusy(null)
      void refreshLibrary()
    }
  }

  return (
    <div className="setup">
      <img className="setup-logo" src={logo} alt="" />
      <h1>캐릭터 분류 시작하기</h1>
      <p className="hint">그림 폴더를 등록하면 게임 · 캐릭터 · 등급을 자동으로 붙이고, 원하면 폴더로 정리합니다. 그림은 PC 밖으로 나가지 않습니다.</p>

      <ol className="setup-steps">
        <li className={hasModel ? 'done' : 'now'}>
          <span className="setup-no">{hasModel ? <CheckIcon /> : 1}</span>
          <div className="setup-body">
            <div className="row-title">분류 모델 받기</div>
            <div className="row-desc">
              {tagger?.label ?? 'WD SwinV2 Tagger v3'} · 약 {mb(tagger?.totalBytes ?? 470_000_000)}MB · {tagger?.license ?? 'Apache-2.0'}. 한 번만 받으면 됩니다.
              {busy === 'model' && dl && dl.total > 0 && (
                <span>
                  {' '}
                  · 받는 중 {mb(dl.done)} / {mb(dl.total)} MB
                </span>
              )}
            </div>
            {busy === 'model' && dl && dl.total > 0 && (
              <div className="setup-bar">
                <div style={{ width: `${Math.round((dl.done / dl.total) * 100)}%` }} />
              </div>
            )}
          </div>
          {!hasModel && (
            <button className="btn primary" disabled={busy !== null} onClick={() => void getModel()}>
              <DownloadIcon />
              {busy === 'model' ? '받는 중…' : '받기'}
            </button>
          )}
        </li>
        <li className={!hasModel ? '' : dirs.length ? 'done' : 'now'}>
          <span className="setup-no">{dirs.length ? <CheckIcon /> : 2}</span>
          <div className="setup-body">
            <div className="row-title">그림 폴더 추가</div>
            <div className="row-desc">{dirs.length ? dirs.join(' · ') : '하위 폴더까지 모든 그림을 가져옵니다. 원본은 읽기만 합니다.'}</div>
          </div>
          <button className="btn" onClick={() => void addFolder()}>
            <AddIcon />
            폴더 추가
          </button>
        </li>
        <li className={hasModel && dirs.length ? 'now' : ''}>
          <span className="setup-no">3</span>
          <div className="setup-body">
            <div className="row-title">가져오기 · 분류</div>
            <div className="row-desc">그림을 가져와 바로 분류합니다. 진행 상황은 아래 작업 표시줄에 나옵니다.</div>
          </div>
          <button className="btn primary" disabled={!hasModel || !dirs.length || busy !== null} onClick={() => void start()}>
            <PlayIcon />
            {busy === 'import' ? '진행 중…' : '시작'}
          </button>
        </li>
      </ol>

      <button className="link-btn" onClick={() => setView('settings')}>
        <SettingsIcon /> 보조 모델 · 캐릭터 학습 모델 · 정리 폴더는 설정에서 고를 수 있습니다
      </button>
    </div>
  )
}

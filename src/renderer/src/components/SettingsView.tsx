// 설정: source folders + import, model download, display, thresholds, data.
import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { AssistMode, ModelId, SafeMode, Thresholds } from '../../../shared/types'
import { AddIcon, CloseIcon, DeleteIcon, DownloadIcon, FolderOpenIcon, PlayIcon, RestartIcon } from './icons'
import Stepper from './Stepper'
import { DEFAULT_THRESHOLDS, DEFAULT_IGNORED } from '../../../shared/defaults'

// [key, label, description, step, min, max]
const THRESHOLDS: [keyof Thresholds, string, string, number, number, number][] = [
  ['autoAccept', '자동 확정 점수', '캐릭터 점수가 이 값 이상이면 그림에 있다고 보고 자동 확정합니다.', 0.05, 0.05, 1],
  ['candidateMin', '후보 최소 점수', '이 값 미만인 캐릭터 점수는 무시합니다. 모두 미만이면 미확인.', 0.05, 0, 1],
  ['reviewMin', '추가 후보 기준', '확정된 캐릭터가 있는 그림에서, 다른 후보는 이 값 이상일 때만 검토로 올립니다.', 0.05, 0, 1],
  ['r18Threshold', 'R-18 기준', 'questionable + explicit 점수 합이 이 값 이상이면 R-18.', 0.05, 0.05, 1],
  ['sensitiveThreshold', '민감 기준', 'sensitive 점수가 이 값 이상이면 민감.', 0.05, 0.05, 1],
  ['ratingMargin', '등급 경계 여유', '기준 ± 이 값 안이면 더 엄격한 등급으로 두고 "등급 확인"에 표시.', 0.05, 0, 0.5],
  ['assistAccept', 'PixAI 단독 확정 점수', '기본 모델이 모르는 캐릭터를 PixAI가 이 값 이상으로 보면 확정합니다.', 0.05, 0.5, 1],
  ['agreeMin', '두 모델 일치 점수', '두 모델이 같은 캐릭터를 둘 다 이 값 이상으로 보면 확정합니다.', 0.05, 0.1, 1],
  ['camieSoloMin', 'Camie 단독 후보 점수', 'Camie만 본 캐릭터는 이 값 이상일 때만 검토에 올립니다 (확정은 하지 않음).', 0.05, 0.25, 1],
  ['groupThreshold', '단체 폴더 인원', '같은 게임에서 이 인원 이상이면 단체 폴더로 (정리 단계에서 사용).', 1, 2, 20]
]
const ASSIST: [AssistMode, string, ModelId[]][] = [
  ['none', '사용 안 함', []],
  ['pixai', 'PixAI', ['pixai']],
  ['pixai+camie', 'PixAI + Camie', ['pixai', 'camie']]
]
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
const SAFE: [SafeMode, string][] = [
  ['show', '표시'],
  ['blur', '블러'],
  ['hide', '숨김']
]
const mb = (n: number): string => `${Math.round(n / 1024 / 1024)}MB`

export default function SettingsView(): JSX.Element {
  const { settings, info, saveSettings, models, refreshModels, showToast, jobs, tree, refreshLibrary } = useStore()
  const [busy, setBusy] = useState<'import' | 'classify' | 'model' | null>(null)
  const [newTag, setNewTag] = useState('')
  if (!settings) return <div className="page" />
  const tagger = models.find((m) => m.id === 'wd')
  const running = Object.keys(jobs).length > 0

  const run = async (kind: 'import' | 'classify' | 'model', fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    setBusy(kind)
    try {
      showToast(await fn())
    } finally {
      setBusy(null)
      void refreshModels()
      void refreshLibrary()
    }
  }
  const addSource = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir && !settings.sourceDirs.includes(dir)) await saveSettings({ sourceDirs: [...settings.sourceDirs, dir] })
  }
  const pickOrganize = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) await saveSettings({ organizeDir: dir })
  }

  return (
    <div className="page settings">
      <h1>설정</h1>

      <section className="card">
        <h2>폴더</h2>
        <div className="row">
          <div className="row-text">
            <div className="row-title">원본 폴더</div>
            <div className="row-desc">하위 폴더까지 모든 이미지를 가져옵니다. 원본 파일은 읽기만 합니다.</div>
          </div>
          <div className="flat-group">
            <button className="mini" onClick={() => void addSource()}>
              <AddIcon />
              추가
            </button>
          </div>
        </div>
        {settings.sourceDirs.length === 0 && <div className="row-desc pad">등록된 폴더가 없습니다.</div>}
        {settings.sourceDirs.map((d) => (
          <div className="path-row" key={d}>
            <span className="path selectable">{d}</span>
            <div className="flat-group">
              <button className="mini" onClick={() => void window.api.showInFolder(d)}>
                <FolderOpenIcon />
                열기
              </button>
              <button
                className="mini"
                onClick={() => void saveSettings({ sourceDirs: settings.sourceDirs.filter((x) => x !== d) })}
              >
                <DeleteIcon />
                제거
              </button>
            </div>
          </div>
        ))}
        <div className="row">
          <div className="row-text">
            <div className="row-title">정리 폴더</div>
            <div className="row-desc">분류가 확정된 원본을 옮길 폴더 (이동은 다음 단계에서 동작). 가져오기 대상에서 제외됩니다.</div>
            {settings.organizeDir && <div className="row-desc selectable">{settings.organizeDir}</div>}
          </div>
          <div className="flat-group">
            <button className="mini" onClick={() => void pickOrganize()}>
              <FolderOpenIcon />
              {settings.organizeDir ? '변경' : '선택'}
            </button>
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">가져오기</div>
            <div className="row-desc">새 이미지를 가져오고, 모델이 있으면 바로 분류합니다.</div>
            {(tree?.counts.unclassified ?? 0) > 0 && (
              <div className="row-desc">분류 전 이미지 {tree?.counts.unclassified}장</div>
            )}
          </div>
          <div className="flat-group">
            <button
              className="mini"
              disabled={!settings.sourceDirs.length || running || busy !== null}
              onClick={() => void run('import', () => window.api.runImport())}
            >
              <PlayIcon />
              가져오기 실행
            </button>
            <button
              className="mini"
              disabled={!tagger?.installed || running || busy !== null}
              onClick={() => void run('classify', () => window.api.runClassify())}
            >
              분류만 실행
            </button>
            <button
              className="mini"
              disabled={!tagger?.installed || running || busy !== null}
              title="이미 분류한 이미지도 다시 분류합니다. 직접 확정한 결과는 유지됩니다."
              onClick={() => void run('classify', () => window.api.reclassifyAll())}
            >
              전체 다시 분류
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>모델</h2>
        {(['wd', 'pixai', 'camie'] as const).map((id) => {
          const m = models.find((x) => x.id === id)
          if (!m) return null
          return (
            <div className="row" key={id}>
              <div className="row-text">
                <div className="row-title">{m.label}</div>
                <div className="row-desc">
                  {m.installed ? `설치됨 · ${mb(m.bytes)}` : `${id === 'wd' ? '받아야 분류 기능을 쓸 수 있습니다' : '선택 설치'} · 약 ${mb(m.totalBytes)}`}
                  {' · '}
                  {m.license}
                  {m.note && <div className="row-warn">{m.note}</div>}
                </div>
              </div>
              <div className="flat-group">
                {m.installed ? (
                  <button className="mini" disabled={running} onClick={() => void window.api.deleteModel(id).then(refreshModels)}>
                    <DeleteIcon />
                    삭제
                  </button>
                ) : (
                  <button className="mini" disabled={busy !== null} onClick={() => void run('model', () => window.api.downloadModel(id))}>
                    <DownloadIcon />
                    받기
                  </button>
                )}
              </div>
            </div>
          )
        })}
        <div className="row">
          <div className="row-text">
            <div className="row-title">보조 모델 사용</div>
            <div className="row-desc">기본 모델이 확정하지 못한 이미지(검토·미확인)만 보조 모델로 한 번 더 봅니다.</div>
            <div className="assist-help">
              <div>
                <b>PixAI</b> — 캐릭터 3,720명. PixAI가 0.9 이상으로 보거나 기본 모델과 의견이 같으면 확정합니다. 오인식이 적고 검토가
                적게 늘어납니다. <span className="hint">권장</span>
              </div>
              <div>
                <b>PixAI + Camie</b> — Camie(캐릭터 26,968명)가 더해져 PixAI도 모르는 캐릭터까지 찾습니다. 대신 Camie는 자신 있게
                틀리는 경우가 있어 혼자서는 확정하지 않고, 다른 모델과 같을 때만 확정합니다. Camie만 본 캐릭터는 검토로 올라가므로
                <b> 확인할 이미지가 늘어납니다.</b> 처리 시간도 조금 더 걸립니다.
              </div>
            </div>
          </div>
          <div className="flat-group">
            {ASSIST.map(([v, l, need]) => (
              <button
                key={v}
                className={`mini ${settings.assistMode === v ? 'on' : ''}`}
                disabled={need.some((id) => !models.find((x) => x.id === id)?.installed)}
                title={need.length ? `필요: ${need.join(', ')}` : undefined}
                onClick={() => void saveSettings({ assistMode: v })}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">GPU 사용</div>
            <div className="row-desc">Windows에서 DirectML로 추론합니다. 안 되면 자동으로 CPU를 씁니다.</div>
          </div>
          <div className="flat-group">
            {[true, false].map((v) => (
              <button key={String(v)} className={`mini ${settings.useGpu === v ? 'on' : ''}`} onClick={() => void saveSettings({ useGpu: v })}>
                {v ? '켜기' : '끄기'}
              </button>
            ))}
          </div>
        </div>
      </section>

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
        {(
          [
            ['safeR18', 'R-18 썸네일'],
            ['safeSensitive', '민감 썸네일']
          ] as const
        ).map(([key, label]) => (
          <div className="row" key={key}>
            <div className="row-text">
              <div className="row-title">{label}</div>
            </div>
            <div className="flat-group">
              {SAFE.map(([v, l]) => (
                <button key={v} className={`mini ${settings[key] === v ? 'on' : ''}`} onClick={() => void saveSettings({ [key]: v })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>분류 기준</h2>
          <div className="flat-group">
            <button
              className="mini"
              disabled={THRESHOLDS.every(([k]) => settings.thresholds[k] === DEFAULT_THRESHOLDS[k])}
              onClick={() => void saveSettings({ thresholds: { ...DEFAULT_THRESHOLDS } })}
            >
              <RestartIcon />
              전체 기본값
            </button>
          </div>
        </div>
        <div className="row-desc">값을 바꾸면 이미 분류한 이미지에도 바로 다시 적용됩니다 (모델을 다시 돌리지 않음).</div>
        {THRESHOLDS.map(([k, label, desc, step, min, max]) => (
          <div className="row" key={k}>
            <div className="row-text">
              <div className="row-title">{label}</div>
              <div className="row-desc">
                {desc} <span className="row-default">· 기본 {DEFAULT_THRESHOLDS[k]}</span>
              </div>
            </div>
            <Stepper
              value={settings.thresholds[k]}
              step={step}
              min={min}
              max={max}
              onChange={(v) => void saveSettings({ thresholds: { ...settings.thresholds, [k]: v } })}
            />
            <button
              className="reset-btn"
              title="기본값으로"
              disabled={settings.thresholds[k] === DEFAULT_THRESHOLDS[k]}
              onClick={() => void saveSettings({ thresholds: { ...settings.thresholds, [k]: DEFAULT_THRESHOLDS[k] } })}
            >
              <RestartIcon />
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>무시할 캐릭터 태그</h2>
          <div className="flat-group">
            <button
              className="mini"
              disabled={sameList(settings.ignoredCharacterTags, DEFAULT_IGNORED)}
              onClick={() => void saveSettings({ ignoredCharacterTags: [...DEFAULT_IGNORED] })}
            >
              <RestartIcon />
              기본값
            </button>
          </div>
        </div>
        <div className="row-desc">
          캐릭터로 치지 않을 태그 (플레이어·마스코트 등). 태거 태그 이름 그대로 입력하세요. 예: sensei_(blue_archive)
        </div>
        <div className="tag-list">
          {settings.ignoredCharacterTags.map((t) => (
            <span className="tag-chip" key={t}>
              {t}
              <button
                title="빼기"
                onClick={() => void saveSettings({ ignoredCharacterTags: settings.ignoredCharacterTags.filter((x) => x !== t) })}
              >
                <CloseIcon />
              </button>
            </span>
          ))}
        </div>
        <input
          className="tag-input"
          value={newTag}
          placeholder="태그 입력 후 Enter"
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            const t = newTag.trim().toLowerCase().replace(/\s+/g, '_')
            if (e.key === 'Enter' && t) {
              if (!settings.ignoredCharacterTags.includes(t)) void saveSettings({ ignoredCharacterTags: [...settings.ignoredCharacterTags, t] })
              setNewTag('')
            }
          }}
        />
      </section>

      <section className="card">
        <h2>데이터</h2>
        <div className="row">
          <div className="row-text">
            <div className="row-title">데이터 폴더</div>
            <div className="row-desc selectable">{info?.dataDir}</div>
          </div>
          <div className="flat-group">
            <button className="mini" onClick={() => info && void window.api.showInFolder(info.dbPath)}>
              <FolderOpenIcon />
              열기
            </button>
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

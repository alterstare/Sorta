// 설정: source folders + import, model download, display, thresholds, data.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import { embedded } from '../embed'
import type { AssistMode, ModelId, Thresholds } from '../../../shared/types'
import { AddIcon, CheckIcon, CloseIcon, DeleteIcon, DownloadIcon, FolderOpenIcon, PlayIcon, RestartIcon, UndoIcon } from './icons'
import Stepper from './Stepper'
import OrganizeCard from './OrganizeCard'
import { DEFAULT_THRESHOLDS, DEFAULT_IGNORED } from '../../../shared/defaults'

// [key, label, description, step, min, max]
const THRESHOLDS: [keyof Thresholds, string, string, number, number, number][] = [
  ['autoAccept', '자동 확정 점수', '캐릭터 점수가 이 값 이상이면 그림에 있다고 보고 자동 확정합니다.', 0.05, 0.05, 1],
  ['candidateMin', '후보 최소 점수', '이 값 미만인 캐릭터 점수는 무시합니다. 모두 미만이면 미확인.', 0.05, 0, 1],
  ['reviewMin', '추가 후보 기준', '확정된 캐릭터가 있는 그림에서, 다른 후보는 이 값 이상일 때만 검토로 올립니다.', 0.05, 0, 1],
  ['r18Threshold', 'R-18 기준', 'explicit(성행위 · 노출) 점수가 이 값 이상이면 R-18.', 0.05, 0.05, 1],
  ['sensitiveThreshold', '민감 기준', 'sensitive + questionable(수영복 · 속옷 · 반라 등) 점수 합이 이 값 이상이면 민감.', 0.05, 0.05, 1],
  ['ratingMargin', '등급 경계 여유', '기준 ± 이 값 안이면 더 엄격한 등급으로 두고 "등급 확인"에 표시.', 0.05, 0, 0.5],
  ['assistAccept', 'PixAI 단독 확정 점수', '기본 모델이 모르는 캐릭터를 PixAI가 이 값 이상으로 보면 확정합니다.', 0.05, 0.5, 1],
  ['agreeMin', '두 모델 일치 점수', '두 모델이 같은 캐릭터를 둘 다 이 값 이상으로 보면 확정합니다.', 0.05, 0.1, 1],
  ['camieSoloMin', 'Camie 단독 후보 점수', 'Camie만 본 캐릭터는 이 값 이상일 때만 검토에 올립니다 (확정은 하지 않습니다).', 0.05, 0.25, 1],
  [
    'knnCandidate',
    '학습 캐릭터 후보 유사도',
    '학습한 캐릭터와 이 값 이상 닮으면 후보로 올립니다 (같은 캐릭터 기준 약 0.64).',
    0.01,
    0.3,
    1
  ],
  ['knnAccept', '학습 캐릭터 확정 유사도', '학습한 캐릭터와 이 값 이상 닮고 2등과 충분히 차이 나면 확정합니다.', 0.01, 0.5, 1],
  ['knnMargin', '학습 캐릭터 1·2등 차이', '확정하려면 가장 닮은 캐릭터가 두 번째보다 이만큼 더 닮아야 합니다.', 0.01, 0, 0.5],
  ['clusterSimilarity', '미확인 묶음 유사도', '미확인 그림끼리 이 값 이상 닮으면 한 묶음으로 보여줍니다.', 0.01, 0.5, 0.95],
  ['dupDistance', '중복 판정 거리', '두 그림의 지문(pHash 64칸)이 이 칸 수 이하로 다르면 중복으로 봅니다. 작을수록 엄격합니다.', 1, 0, 20],
  [
    'dupDetail',
    '중복 세부 차이',
    '비슷해 보여도 작은 부분(표정 · 검열 등)이 이 값보다 다르면 차분으로 보고 중복에서 뺍니다. 클수록 너그럽습니다.',
    1,
    0,
    40
  ],
  ['groupThreshold', '단체 폴더 인원', '같은 게임에서 이 인원 이상이면 단체 폴더로 (정리 단계에서 사용).', 1, 2, 20]
]
const ASSIST: [AssistMode, string, ModelId[], string][] = [
  ['none', '미사용', [], '기본 모델만 씁니다. 가장 빠르고, 기본 모델이 모르는 캐릭터는 검토나 미확인으로 남습니다.'],
  [
    'pixai',
    'PixAI (권장)',
    ['pixai'],
    '캐릭터 3,720명. PixAI가 0.9 이상으로 보거나 기본 모델과 의견이 같으면 확정합니다. 오인식이 적고 검토가 적게 늘어납니다.'
  ],
  [
    'pixai+camie',
    'PixAI + Camie',
    ['pixai', 'camie'],
    'Camie(캐릭터 26,968명)가 더해져 PixAI도 모르는 캐릭터까지 찾습니다. Camie는 혼자서는 확정하지 않아 확인할 이미지가 늘고, 처리 시간도 조금 더 걸립니다.'
  ]
]
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
const mb = (n: number): string => `${Math.round(n / 1024 / 1024)}MB`

export default function SettingsView(): JSX.Element {
  const pageRef = useKeptScroll<HTMLDivElement>('settings')
  const { settings, info, saveSettings, models, refreshModels, showToast, jobs, tree, refreshLibrary, update } = useStore()
  const [busy, setBusy] = useState<'import' | 'classify' | 'model' | null>(null)
  const [newTag, setNewTag] = useState('')
  // 분류 기준: edits stay a draft until the settings screen is left (or 지금 적용).
  const [draft, setDraft] = useKept<Thresholds | null>('settings.thresholdsDraft', null)
  useEffect(
    () => () => {
      const st = useStore.getState()
      const d = st.kept['settings.thresholdsDraft'] as Thresholds | null | undefined
      if (!d || !st.settings) return
      useStore.setState((x) => ({
        kept: { ...x.kept, 'settings.thresholdsDraft': null }
      }))
      if (JSON.stringify(d) !== JSON.stringify(st.settings.thresholds)) {
        void st.saveSettings({ thresholds: d }).then(() => st.showToast({ ok: true, message: '바뀐 분류 기준을 적용합니다' }))
      }
    },
    []
  )
  if (!settings) return <div className="page" />
  const tagger = models.find((m) => m.id === 'wd')
  const th = draft ?? settings.thresholds
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(settings.thresholds)
  const editTh = (patch: Partial<Thresholds>): void => setDraft({ ...th, ...patch })
  const applyNow = (): void => {
    if (!draft) return
    void saveSettings({ thresholds: draft })
    setDraft(null)
  }
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
    <div ref={pageRef} className="page settings">
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
                onClick={() =>
                  void saveSettings({
                    sourceDirs: settings.sourceDirs.filter((x) => x !== d)
                  })
                }
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
            <div className="row-desc">분류가 끝난 원본을 게임 · 캐릭터 폴더로 옮겨 정리합니다. 가져오기 대상에서 제외됩니다.</div>
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
            <div className="row-title">감시</div>
            <div className="row-desc">원본 폴더에 새 그림이 생기면 자동으로 가져와 분류합니다.</div>
          </div>
          <div className="flat-group">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                className={`mini ${settings.watch === v ? 'on' : ''}`}
                onClick={() => void saveSettings({ watch: v })}
              >
                {v ? '켜기' : '끄기'}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">가져오기</div>
            <div className="row-desc">새 이미지를 가져오고, 모델이 있으면 바로 분류합니다.</div>
            {(tree?.counts.unclassified ?? 0) > 0 && <div className="row-desc">분류 전 이미지 {tree?.counts.unclassified}장</div>}
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

      <OrganizeCard />

      <section className="card">
        <h2>모델</h2>
        {(['wd', 'pixai', 'camie', 'ccip'] as const).map((id) => {
          const m = models.find((x) => x.id === id)
          if (!m) return null
          return (
            <div className="row" key={id}>
              <div className="row-text">
                <div className="row-title">{m.label}</div>
                <div className="row-desc">
                  {m.installed
                    ? `설치 완료 · ${mb(m.bytes)}`
                    : `${id === 'wd' ? '받아야 분류 기능을 쓸 수 있습니다' : '선택 설치'} · 약 ${mb(m.totalBytes)}`}
                  {' · '}
                  {m.license}
                  {m.note && <div>{m.note}</div>}
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
        <div className="row col">
          <div className="row-text">
            <div className="row-title">보조 모델 사용</div>
            <div className="row-desc">기본 모델이 확정하지 못한 이미지(검토·미확인)만 보조 모델로 한 번 더 봅니다.</div>
          </div>
          <div className="choice-cards" role="radiogroup">
            {ASSIST.map(([v, l, need, desc]) => {
              const missing = need.filter((id) => !models.find((x) => x.id === id)?.installed)
              const on = settings.assistMode === v
              return (
                <button
                  key={v}
                  className={`choice-card ${on ? 'on' : ''}`}
                  role="radio"
                  aria-checked={on}
                  disabled={missing.length > 0}
                  onClick={() => void saveSettings({ assistMode: v })}
                >
                  <span className="choice-radio">{on && <span className="menu-dot" />}</span>
                  <span className="choice-name">{l}</span>
                  <span className="choice-desc">{desc}</span>
                  {missing.length > 0 && <span className="choice-need">위 모델 목록에서 받으면 고를 수 있습니다</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">외부 조회 허용</div>
            <div className="row-desc">
              캐릭터 학습(참고 그림 받기)과 소속 위키 조회에 캐릭터 이름만 보냅니다. 내 그림은 밖으로 보내지 않습니다.
            </div>
          </div>
          <div className="flat-group">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                className={`mini ${settings.allowWebLookup === v ? 'on' : ''}`}
                onClick={() => void saveSettings({ allowWebLookup: v })}
              >
                {v ? '허용' : '차단'}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">학습 그림 출처</div>
            <div className="row-desc">
              Danbooru는 자료가 가장 많고 민감 등급(수영복 등)까지 쓸 수 있습니다. 통신사 차단은 내장된 우회(Halftone과 같은 방식)로
              접속하며, 접속이 안 되면 자동으로 Safebooru(전체연령만)를 씁니다.
            </div>
          </div>
          <div className="flat-group">
            {(['danbooru', 'safebooru'] as const).map((v) => (
              <button
                key={v}
                className={`mini ${settings.booruSource === v ? 'on' : ''}`}
                onClick={() => void saveSettings({ booruSource: v })}
              >
                {v === 'danbooru' ? 'Danbooru' : 'Safebooru'}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">민감 등급 그림도 학습에 사용</div>
            <div className="row-desc">
              수영복·바니 같은 복장은 대부분 민감 등급입니다. 참고 그림은 특징만 뽑고 저장하지 않습니다. (Danbooru 전용)
            </div>
          </div>
          <div className="flat-group">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                className={`mini ${settings.learnSensitive === v ? 'on' : ''}`}
                onClick={() => void saveSettings({ learnSensitive: v })}
              >
                {v ? '사용' : '미사용'}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">참고 그림 수</div>
            <div className="row-desc">캐릭터 하나를 학습할 때 받는 참고 그림 수입니다. 많을수록 정확하지만 오래 걸립니다.</div>
          </div>
          <Stepper
            value={settings.learnPerCharacter}
            min={5}
            max={100}
            step={5}
            onChange={(v) => void saveSettings({ learnPerCharacter: v })}
          />
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">최소 그림 수</div>
            <div className="row-desc">쓸 수 있는 그림이 이보다 적은 캐릭터는 학습하지 않고 "그림 부족"으로 둡니다.</div>
          </div>
          <Stepper value={settings.learnMinPosts} min={1} max={200} step={5} onChange={(v) => void saveSettings({ learnMinPosts: v })} />
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">GPU 사용</div>
            <div className="row-desc">
              {navigator.userAgent.includes('Windows')
                ? 'DirectML로 그래픽카드를 씁니다 (NVIDIA · AMD · Intel 모두). Windows용 추론 엔진은 CUDA를 지원하지 않아 NVIDIA도 DirectML로 동작합니다.'
                : 'NVIDIA 그래픽카드에서 CUDA를 씁니다 (드라이버 + CUDA 12 + cuDNN 9 설치 필요).'}{' '}
              안 되면 자동으로 CPU를 씁니다.
            </div>
          </div>
          <div className="flat-group">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                className={`mini ${settings.useGpu === v ? 'on' : ''}`}
                onClick={() => void saveSettings({ useGpu: v })}
              >
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
            {embedded && <div className="row-desc">Halftone 안에서는 Halftone 테마를 따릅니다.</div>}
          </div>
          <div className="flat-group">
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} className={`mini ${settings.theme === t ? 'on' : ''}`} disabled={embedded} onClick={() => void saveSettings({ theme: t })}>
                {t === 'light' ? '라이트' : '다크'}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">스크롤로 넘기기</div>
            <div className="row-desc">
              크게 보기에서 마우스 휠로 이전 · 다음 이미지로 넘깁니다. 썸네일 마스킹(블러 · 숨기기)은 라이브러리 위쪽 마스킹 메뉴에서
              정합니다.
            </div>
          </div>
          <div className="flat-group">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                className={`mini ${settings.wheelNavigate === v ? 'on' : ''}`}
                onClick={() => void saveSettings({ wheelNavigate: v })}
              >
                {v ? '사용' : '미사용'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>분류 기준</h2>
          <div className="flat-group">
            {dirty && (
              <button className="mini" onClick={applyNow}>
                <CheckIcon />
                지금 적용
              </button>
            )}
            {dirty && (
              <button className="mini" onClick={() => setDraft(null)}>
                <UndoIcon />
                바꾼 값 취소
              </button>
            )}
            <button
              className="mini"
              disabled={THRESHOLDS.every(([k]) => th[k] === DEFAULT_THRESHOLDS[k])}
              onClick={() => setDraft({ ...DEFAULT_THRESHOLDS })}
            >
              <RestartIcon />
              전체 기본값
            </button>
          </div>
        </div>
        <div className={`row-desc ${dirty ? 'th-dirty' : ''}`}>
          {dirty
            ? '바꾼 값은 설정 화면을 나가면 이미 분류한 이미지에도 다시 적용됩니다 (모델을 다시 돌리지 않습니다).'
            : '값을 바꾸면 설정 화면을 나갈 때 이미 분류한 이미지에도 다시 적용됩니다 (모델을 다시 돌리지 않습니다).'}
        </div>
        {THRESHOLDS.map(([k, label, desc, step, min, max]) => (
          <div className="row" key={k}>
            <div className="row-text">
              <div className="row-title">{label}</div>
              <div className="row-desc">
                {desc} <span className="row-default">· 기본 {DEFAULT_THRESHOLDS[k]}</span>
              </div>
            </div>
            <Stepper value={th[k]} step={step} min={min} max={max} onChange={(v) => editTh({ [k]: v })} />
            <button
              className="reset-btn"
              title="기본값으로"
              disabled={th[k] === DEFAULT_THRESHOLDS[k]}
              onClick={() => editTh({ [k]: DEFAULT_THRESHOLDS[k] })}
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
              onClick={() =>
                void saveSettings({
                  ignoredCharacterTags: [...DEFAULT_IGNORED]
                })
              }
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
                onClick={() =>
                  void saveSettings({
                    ignoredCharacterTags: settings.ignoredCharacterTags.filter((x) => x !== t)
                  })
                }
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
              if (!settings.ignoredCharacterTags.includes(t))
                void saveSettings({
                  ignoredCharacterTags: [...settings.ignoredCharacterTags, t]
                })
              setNewTag('')
            }
          }}
        />
      </section>

      {/* inside Halftone the host app updates itself */}
      {!info?.embedded && (
        <section className="card">
          <h2>앱</h2>
          <div className="row">
            <div className="row-text">
              <div className="row-title">자동 업데이트</div>
              <div className="row-desc">새 버전이 나오면 받아 두었다가 다음 실행 때 적용합니다. 끄면 업데이트를 확인하지 않습니다.</div>
              <div className="row-desc">
                현재 버전 {info?.version}
                {' · '}
                {
                  {
                    idle: '',
                    dev: '개발 실행 중이라 업데이트를 확인하지 않습니다',
                    checking: '확인 중…',
                    none: '최신 버전입니다',
                    available: `새 버전 ${update.version}을(를) 받습니다`,
                    downloading: `새 버전 ${update.version} 받는 중 ${update.percent ?? 0}%`,
                    downloaded: `새 버전 ${update.version} 준비 완료 · 재시작하면 적용됩니다`,
                    error: `확인 실패: ${update.error ?? ''}`
                  }[update.state]
                }
              </div>
            </div>
            <div className="flat-group">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  className={`mini ${settings.autoUpdate === v ? 'on' : ''}`}
                  onClick={() => void saveSettings({ autoUpdate: v })}
                >
                  {v ? '켜기' : '끄기'}
                </button>
              ))}
              {update.state === 'downloaded' ? (
                <button className="mini" onClick={() => window.api.installUpdate()}>
                  <RestartIcon />
                  재시작해서 업데이트
                </button>
              ) : (
                <button
                  className="mini"
                  disabled={update.state === 'dev' || update.state === 'checking' || update.state === 'downloading'}
                  onClick={() => void window.api.checkUpdate().then((u) => useStore.setState({ update: u }))}
                >
                  <RestartIcon />
                  지금 확인
                </button>
              )}
            </div>
          </div>
        </section>
      )}

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

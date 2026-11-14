// 조직도 불러오기: a wiki page listing the game's affiliations (link) or a
// picture of an org chart (read by the LLM set in 설정 → LLM; optionally
// taking the picture's Korean names) → a preview of what changes (new / moved
// boxes, renames, aliases, characters placed) → 적용, one Ctrl+Z step.
import { useState } from 'react'
import type { JSX } from 'react'
import type { OrgImportPreview } from '../../../shared/types'
import { ArrowForwardIcon, ImageIcon, LinkIcon } from './icons'
import { arrowText } from '../arrowText'
import { Check } from './PackDialogs'
import ImageDrop from './ImageDrop'
import type { PickedImage } from './ImageDrop'

export default function OrgImport({
  mode,
  series,
  wiki,
  onClose,
  onApply
}: {
  mode: 'link' | 'image'
  series: string
  wiki: string | null // the game's wiki domain: prefills the address
  onClose: () => void
  onApply: (pv: OrgImportPreview) => Promise<boolean>
}): JSX.Element {
  const [url, setUrl] = useState(wiki ? `https://${wiki}/wiki/` : '')
  const [image, setImage] = useState<PickedImage | null>(null)
  // 소속 및 학생 이름 한글로 번역: names become the picture's Korean ones
  const [translate, setTranslate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pv, setPv] = useState<OrgImportPreview | null>(null)

  const read = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    setPv(null)
    try {
      setPv(mode === 'link' ? await window.api.orgImportLink(series, url.trim()) : await window.api.orgImportImage(series, image!.data, image!.name, translate))
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }
  const apply = async (): Promise<void> => {
    if (!pv) return
    setBusy(true)
    if (await onApply(pv)) onClose()
    setBusy(false)
  }
  const ready = mode === 'link' ? /^https?:\/\/.+\/.+/.test(url.trim()) : !!image

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal org-import" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-title">
          <h2>
            {mode === 'link' ? <LinkIcon /> : <ImageIcon />}
            조직도 불러오기 · {mode === 'link' ? '링크' : '이미지'}
          </h2>
          <div className="row-desc">
            {arrowText(
              mode === 'link'
                ? `${series}의 소속을 정리해 둔 위키 문서 주소를 넣으세요. 제목(학교 등) 아래에 목록(동아리 등)이 있는 문서를 읽습니다. 예: https://bluearchive.fandom.com/wiki/School_Club`
                : `${series}의 조직도 그림을 고르거나 끌어다 놓거나 붙여넣으세요(Ctrl+V). 설정 → LLM의 모델이 그림을 읽어 소속과 캐릭터를 정리합니다.`
            )}
          </div>
        </div>

        {mode === 'link' ? (
          <div className="org-import-url">
            <input
              className="tag-input"
              autoFocus
              value={url}
              placeholder="https://….fandom.com/wiki/문서"
              spellCheck={false}
              onChange={(e) => (setUrl(e.target.value), setPv(null))}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && ready && !busy) void read()
              }}
            />
            <button className="btn" disabled={!ready || busy} onClick={() => void read()}>
              {busy ? '읽는 중…' : '읽기'}
            </button>
          </div>
        ) : (
          <>
            <ImageDrop image={image} onImage={(img) => (setImage(img), setPv(null), setErr(''))} />
            <div className="org-import-file">
              <Check on={translate} onClick={() => (setTranslate(!translate), setPv(null))}>
                소속 및 학생 이름 한글로 번역
              </Check>
              <span className="dim">{translate ? '그림의 한글 이름으로 바꾸고, 원래 이름은 별칭으로 남깁니다.' : image?.name}</span>
              <button className="btn" disabled={!ready || busy} onClick={() => void read()}>
                {busy ? 'LLM이 읽는 중…' : '읽기'}
              </button>
            </div>
          </>
        )}

        {err && <div className="pack-warn">{arrowText(err)}</div>}
        {pv && (
          <>
            <div className="pack-stats">
              <span>
                새 소속 <b>{pv.created}</b>개
              </span>
              <span>
                옮길 소속 <b>{pv.moved}</b>개
              </span>
              {pv.translate && (
                <span>
                  한글로 바꿀 이름 <b>{pv.renamed}</b>개
                </span>
              )}
              {(pv.placed > 0 || pv.unknown.length > 0) && (
                <span>
                  지정할 캐릭터 <b>{pv.placed}</b>명{pv.unknown.length ? ` · 못 찾은 이름 ${pv.unknown.length}개` : ''}
                </span>
              )}
            </div>
            <div className="modal-list org-import-rows">
              {pv.rows.map((r, i) => (
                <div className="org-import-row" key={i} style={{ paddingLeft: 10 + r.depth * 18 }}>
                  {r.renamed && (
                    <>
                      <span className="dim">{r.renamed}</span>
                      <ArrowForwardIcon className="txt-arrow" />
                    </>
                  )}
                  <span className="org-import-name">{r.name}</span>
                  {r.status === 'new' && <span className="org-import-tag new">새로 만듦</span>}
                  {r.status === 'moved' && <span className="org-import-tag moved">옮김 · {r.from}에서</span>}
                  {r.aliases.length > 0 && <span className="dim">+ 다른 이름 {r.aliases.join(', ')}</span>}
                  {r.characters.length > 0 && (
                    <span className="org-import-chars">
                      {r.characters.map((c) => (
                        <span key={c.name} className={c.found ? '' : 'missing'} title={c.found ? undefined : '이 게임에 없는 캐릭터라 지정하지 않습니다'}>
                          {c.renamed && (
                            <>
                              <span className="dim">{c.renamed}</span>
                              <ArrowForwardIcon className="txt-arrow" />
                            </>
                          )}
                          {c.name}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="row-desc">
              이름이나 이전 이름이 같은 소속은 그대로 쓰고 위치만 맞춥니다. 목록에 없는 내 소속은 건드리지 않습니다. 전체를 Ctrl+Z 한 번으로 되돌릴 수 있습니다.
            </div>
          </>
        )}

        <div className="modal-foot">
          <button className="btn primary" disabled={!pv || busy || !pv.rows.length} onClick={() => void apply()}>
            적용
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

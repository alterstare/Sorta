// NAS 폴더 추가 (SMB): address + optional login (Halftone's dialog). The login
// is saved in Windows (Credential Manager), not in the app; the folder becomes
// a \\nas\share path.
import { useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'

export default function NasDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (path: string) => void }): JSX.Element {
  const [address, setAddress] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const connect = async (): Promise<void> => {
    if (!address.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.smbConnect({ address, user, password })
      if (r.ok && r.path) onAdded(r.path)
      else setErr(r.error ?? '연결 실패')
    } finally {
      setBusy(false)
    }
  }
  const keys = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') void connect()
    else if (e.key === 'Escape') onClose()
  }
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal nas-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>NAS 폴더 추가 (SMB)</h2>
        </div>
        <div className="row-desc">
          NAS의 공유 폴더 주소를 입력하세요. 계정 정보는 앱이 아니라 윈도우 자격 증명에 저장되고, 추가된 폴더는 일반 폴더처럼 가져오기 · 감시 · 정리에
          쓰입니다.
        </div>
        <label className="nas-field">
          <span>주소</span>
          <input
            className="tag-input"
            autoFocus
            value={address}
            placeholder="\\NAS이름\공유폴더\그림  (또는 smb://192.168.0.10/공유폴더/그림)"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={keys}
          />
        </label>
        <div className="nas-row">
          <label className="nas-field">
            <span>사용자 이름 (선택)</span>
            <input className="tag-input" value={user} onChange={(e) => setUser(e.target.value)} onKeyDown={keys} />
          </label>
          <label className="nas-field">
            <span>비밀번호</span>
            <input className="tag-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={keys} />
          </label>
        </div>
        <div className="modal-foot">
          <span className={`row-desc nas-msg ${err ? 'nas-err' : ''}`}>{busy ? '연결하는 중…' : (err ?? '')}</span>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={() => void connect()} disabled={busy || !address.trim()}>
            연결하고 추가
          </button>
        </div>
      </div>
    </div>
  )
}

// NAS (SMB) folders on Windows (same as Halftone's lib/smb.ts). The share is
// reached through Windows itself: credentials go into the Windows Credential
// Manager (cmdkey), so the app never stores the password, and the folder is
// then an ordinary UNC path (\\nas\share\pictures) that every feature (import,
// watch, organize moves, 폴더 열기) already handles.
import { execFile } from 'child_process'
import { promises as fs } from 'fs'

export interface SmbTarget {
  server: string
  share: string
  unc: string // full UNC path including any sub-folder
}

// Accepts \\nas\share\sub, //nas/share/sub or smb://nas/share/sub.
export function parseSmb(input: string): SmbTarget | null {
  const s = input
    .trim()
    .replace(/^smb:\/\//i, '\\\\')
    .replace(/\//g, '\\')
  const m = s.match(/^\\\\([^\\]+)\\([^\\]+)(\\.*)?$/)
  if (!m) return null
  const rest = (m[3] ?? '').replace(/\\+$/, '')
  return { server: m[1], share: m[2], unc: `\\\\${m[1]}\\${m[2]}${rest}` }
}

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as unknown as number) || 1 : 0
      resolve({ code: typeof code === 'number' ? code : 1, out: `${stdout ?? ''}${stderr ?? ''}` })
    })
  })
}

// readdir with a timeout: an unreachable host can hang for a long time.
function probe(path: string, ms = 15000): Promise<void> {
  return Promise.race([
    fs.readdir(path).then(() => undefined),
    new Promise<void>((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms))
  ])
}

function explain(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code ?? ''
  if (code === 'ENOENT') return '폴더를 찾을 수 없습니다. 공유 이름과 하위 폴더 경로를 확인하세요.'
  if (code === 'EACCES' || code === 'EPERM') return '접근이 거부되었습니다. 사용자 이름·비밀번호와 공유 권한을 확인하세요.'
  if (code === 'ETIMEDOUT') return 'NAS에 연결할 수 없습니다 (시간 초과). 주소와 NAS의 SMB 설정을 확인하세요.'
  return `NAS에 연결할 수 없습니다 (${code || (e as Error)?.message || '알 수 없는 오류'}). 주소와 NAS의 SMB 설정을 확인하세요.`
}

export async function connectSmb(opts: {
  address: string
  user?: string
  password?: string
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (process.platform !== 'win32')
    return { ok: false, error: '이 기능은 윈도우 전용입니다. 다른 OS에서는 NAS를 먼저 마운트한 뒤 그 폴더를 추가하세요.' }
  const t = parseSmb(opts.address)
  if (!t) return { ok: false, error: '주소 형식: \\\\NAS이름\\공유폴더\\하위폴더 (또는 smb://NAS/공유폴더)' }
  const user = opts.user?.trim()
  // Save the login for this NAS in Windows (used for every later connection).
  if (user) {
    const r = await run('cmdkey', [`/add:${t.server}`, `/user:${user}`, `/pass:${opts.password ?? ''}`])
    if (r.code !== 0) return { ok: false, error: '윈도우 자격 증명 저장에 실패했습니다.' }
  }
  try {
    await probe(t.unc)
    return { ok: true, path: t.unc }
  } catch (e) {
    // A connection to this NAS may already be open with other credentials
    // (Windows allows one set per server) — retry once with an explicit login.
    if (user) {
      await run('net', ['use', `\\\\${t.server}\\${t.share}`, '/delete', '/y'])
      const r = await run('net', ['use', `\\\\${t.server}\\${t.share}`, opts.password ?? '', `/user:${user}`, '/persistent:no'])
      if (r.code === 0) {
        try {
          await probe(t.unc)
          return { ok: true, path: t.unc }
        } catch (e2) {
          return { ok: false, error: explain(e2) }
        }
      }
    }
    return { ok: false, error: explain(e) }
  }
}

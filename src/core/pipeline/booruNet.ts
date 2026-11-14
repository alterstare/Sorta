// Network for character learning. Danbooru is SNI-blocked by some ISPs (Korea
// among them), so its requests go through a local green-tunnel proxy — the
// same setup as Halftone: the TLS ClientHello is split into small TLS records
// and hosts are resolved over DoH (1.1.1.1 by IP, so the resolver itself can't
// be blocked). The tunnel is used only by these requests; the OS proxy
// setting is never touched.
import type { Proxy as TunnelT } from 'green-tunnel'
import type { Dispatcher } from 'undici'

let tunnel: TunnelT | null = null
let agent: Promise<Dispatcher> | null = null

async function tunnelAgent(): Promise<Dispatcher> {
  if (!agent) {
    agent = (async () => {
      const { Proxy } = await import('green-tunnel')
      const { ProxyAgent } = await import('undici')
      const t = new Proxy({
        host: '127.0.0.1',
        port: 0,
        fragment: { size: 40, tlsRecords: true },
        dns: { mode: 'doh', dohUrl: 'https://1.1.1.1/dns-query' }
      })
      t.on('error', () => {}) // per-connection errors surface on the request
      const { port } = await t.start()
      tunnel = t
      return new ProxyAgent(`http://127.0.0.1:${port}`)
    })()
    agent.catch(() => (agent = null))
  }
  return agent
}

export interface NetResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  bytes: () => Promise<Buffer>
}

// Cloudflare's check ("Just a moment…": 403 + `cf-mitigated: challenge`) needs
// a browser, which Node isn't. The host (Electron) can pass a GET that goes
// through a browser session where the user clears the check by hand; a host
// that challenged once goes straight there from then on.
export type BrowserGet = (url: string, signal?: AbortSignal) => Promise<NetResponse>
let browserGet: BrowserGet | null = null
const viaBrowser = new Set<string>()
export function setBrowserGet(get: BrowserGet | null): void {
  browserGet = get
  viaBrowser.clear()
}

// The check wasn't cleared (window closed / timed out): stop the job instead
// of asking again for every request.
export class ChallengeError extends Error {}

// GET through the tunnel (viaTunnel) or directly.
export async function netGet(url: string, headers: Record<string, string>, viaTunnel: boolean, signal?: AbortSignal): Promise<NetResponse> {
  const host = new URL(url).hostname
  if (browserGet && viaBrowser.has(host)) return browserGet(url, signal)
  const { fetch } = await import('undici')
  const res = await fetch(url, { headers, signal, dispatcher: viaTunnel ? await tunnelAgent() : undefined })
  if (browserGet && res.status === 403 && res.headers.get('cf-mitigated') === 'challenge') {
    void res.body?.cancel().catch(() => {})
    viaBrowser.add(host)
    return browserGet(url, signal)
  }
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json(),
    bytes: async () => Buffer.from(await res.arrayBuffer())
  }
}

export async function stopTunnel(): Promise<void> {
  const t = tunnel
  tunnel = null
  agent = null
  await t?.stop().catch(() => {})
}

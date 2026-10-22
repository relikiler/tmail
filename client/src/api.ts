const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__
const API_BASE = import.meta.env.VITE_API_BASE || (isTauri ? 'https://195.209.212.237.nip.io/api' : '/api')

export interface User {
  address: string
  plan_id: string
  plan_expires: number | null
  created_at: number
}

export interface Device {
  id: string
  pub_x25519: string
  pub_ed25519: string
  name: string
}

export interface MailMeta {
  id: string
  from_addr: string
  to_addr: string
  ts: number
  size: number
  status: string
}

export interface Mail extends MailMeta {
  ciphertext?: string
  perRecipient?: Record<string, string>
  sig?: string
  attachments?: string[]
  immutable?: boolean
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...opts,
    })
  } catch (e) {
    throw new Error('Network error — check your connection and try again')
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

export const api = {
  register(address: string): Promise<{ ok: boolean; user: User }> {
    return request('/register', { method: 'POST', body: JSON.stringify({ address }) })
  },

  addDevice(address: string, pubX25519: string, pubEd25519: string, name: string): Promise<{ ok: boolean; device: Device }> {
    return request('/devices', {
      method: 'POST',
      body: JSON.stringify({ address, pubX25519, pubEd25519, name }),
    })
  },

  getDevices(address: string): Promise<{ address: string; devices: Device[] }> {
    return request(`/devices/${address}`)
  },

  sendMail(payload: {
    id: string
    from: string
    to: string[]
    ciphertext: string
    perRecipient: Record<string, string>
    sig: string
    ts: number
    size: number
    attachments?: string[]
    immutable?: number
  }): Promise<{ ok: boolean; id: string; status: string }> {
    return request('/mails', { method: 'POST', body: JSON.stringify(payload) })
  },

  inbox(address: string): Promise<{ address: string; mails: MailMeta[] }> {
    return request(`/mails/inbox/${address}`)
  },

  getMail(id: string): Promise<Mail> {
    return request(`/mails/${id}`)
  },

  checkSubscription(address: string): Promise<{ planId: string; planExpires: number | null; active: boolean; lifetime?: boolean }> {
    return request('/subscribe/check', { method: 'POST', body: JSON.stringify({ address }) })
  },

  authRegister(nickname: string, wrapped: string, pubRecovery: string, salt: string): Promise<{ ok: boolean; nickname: string }> {
    return request('/auth/register', { method: 'POST', body: JSON.stringify({ nickname, wrapped, pubRecovery, salt }) })
  },

  authLogin(nickname: string): Promise<{ ok: boolean; wrapped: string; pubRecovery: string; salt: string }> {
    return request('/auth/login', { method: 'POST', body: JSON.stringify({ nickname }) })
  },

  authRecover(nickname: string, wrapped: string): Promise<{ ok: boolean; nickname: string }> {
    return request('/auth/recover', { method: 'POST', body: JSON.stringify({ nickname, wrapped }) })
  },
}
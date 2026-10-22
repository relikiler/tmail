const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__
const API_BASE = import.meta.env.VITE_API_BASE || (isTauri ? 'https://195.209.212.237.nip.io/api' : '/api')
const PINATA_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/'

export interface EncryptedFile {
  cid: string
  name: string
  size: number
  key: string
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

export async function encryptFile(file: File): Promise<{ encrypted: Blob; key: string }> {
  const key = crypto.getRandomValues(new Uint8Array(32))
  const imported = await crypto.subtle.importKey('raw', toArrayBuffer(key), 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await file.arrayBuffer()
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, imported, data)
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return { encrypted: new Blob([out], { type: 'application/octet-stream' }), key: Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('') }
}

export async function decryptFile(blob: Blob, keyHex: string): Promise<Blob> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const keyBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) keyBytes[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16)
  const imported = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, imported, toArrayBuffer(ct))
  return new Blob([plain])
}

export async function uploadToIPFS(blob: Blob, address?: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'encrypted.bin')
  const headers: Record<string, string> = {}
  if (address) headers['x-tmail-address'] = address
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  const data = await res.json()
  return data.cid
}

export async function downloadFromIPFS(cid: string): Promise<Blob> {
  const res = await fetch(`${PINATA_GATEWAY}${cid}`)
  if (!res.ok) throw new Error(`IPFS download failed: ${res.status}`)
  return res.blob()
}
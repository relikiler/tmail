import { x25519, ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes } from '@noble/hashes/utils.js'

export interface KeypairX25519 {
  secretKey: Uint8Array
  publicKey: Uint8Array
}

export interface EncryptedPayload {
  ephemeralPubkey: string
  nonce: string
  ciphertext: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function generateX25519(): KeypairX25519 {
  const secretKey = x25519.utils.randomSecretKey()
  const publicKey = x25519.getPublicKey(secretKey)
  return { secretKey, publicKey }
}

export function generateEphemeralX25519(): KeypairX25519 {
  const secretKey = x25519.utils.randomSecretKey()
  const publicKey = x25519.getPublicKey(secretKey)
  return { secretKey, publicKey }
}

export function generateEd25519(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const secretKey = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secretKey)
  return { secretKey, publicKey }
}

export function pubKeyHex(key: Uint8Array): string {
  return '0x' + hex(key)
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h
  const bytes = new Uint8Array(s.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(s.substr(i * 2, 2), 16)
  }
  return bytes
}

export function deriveSharedSecret(mySecret: Uint8Array, theirPublic: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(mySecret, theirPublic)
}

export function ed25519Sign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, secretKey)
}

export function ed25519Verify(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): boolean {
  return ed25519.verify(signature, message, publicKey)
}

async function aesKeyFromShared(shared: Uint8Array): Promise<CryptoKey> {
  const hash = sha256(shared)
  return crypto.subtle.importKey('raw', toArrayBuffer(hash), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

export async function encryptAesGcm(shared: Uint8Array, plaintext: string): Promise<EncryptedPayload> {
  const key = await aesKeyFromShared(shared)
  const nonce = randomBytes(12)
  const encoded = encoder.encode(plaintext)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(nonce) }, key, toArrayBuffer(encoded))
  return {
    ephemeralPubkey: '',
    nonce: hex(nonce),
    ciphertext: hex(new Uint8Array(ct)),
  }
}

export async function decryptAesGcm(shared: Uint8Array, payload: EncryptedPayload): Promise<string> {
  const key = await aesKeyFromShared(shared)
  const nonce = fromHex(payload.nonce)
  const ct = fromHex(payload.ciphertext)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(nonce) }, key, toArrayBuffer(ct))
  return decoder.decode(plain)
}

export function prepareSignatureData(from: string, to: string[], bodyHash: string, ts: number): Uint8Array {
  const data = `TMAIL:${from}:${to.join(',')}:${bodyHash}:${ts}`
  return encoder.encode(data)
}
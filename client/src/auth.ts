import { x25519, ed25519 } from '@noble/curves/ed25519.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { argon2id } from 'hash-wasm'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface KeyBundle {
  x25519_sk: string
  x25519_pk: string
  ed25519_sk: string
  ed25519_pk: string
}

export interface Wraps {
  passwordWrap: string
  recoveryWrap: string
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(h: string): Uint8Array {
  return new Uint8Array(h.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
}

async function aesEncrypt(keyBytes: Uint8Array, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, ['encrypt'])
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(data))
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return hex(out)
}

async function aesDecrypt(keyBytes: Uint8Array, wrappedHex: string): Promise<Uint8Array> {
  const raw = fromHex(wrappedHex)
  const iv = raw.slice(0, 12)
  const ct = raw.slice(12)
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, ['decrypt'])
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ct)))
}

function keyFromPassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return argon2id({ password, salt, iterations: 3, parallelism: 2, memorySize: 65536, hashLength: 32, outputType: 'binary' })
}

function keyFromRecovery(recoverySkHex: string): Uint8Array {
  return sha256(fromHex(recoverySkHex))
}

// ==== REGISTRATION ====
export function createIdentity(): {
  bundle: KeyBundle
  recoverySk: string
  recoveryPk: string
} {
  const xsk = x25519.utils.randomSecretKey()
  const xpk = x25519.getPublicKey(xsk)
  const esk = ed25519.utils.randomSecretKey()
  const epk = ed25519.getPublicKey(esk)
  const recSk = ed25519.utils.randomSecretKey()
  const recPk = ed25519.getPublicKey(recSk)

  return {
    bundle: {
      x25519_sk: hex(xsk),
      x25519_pk: hex(xpk),
      ed25519_sk: hex(esk),
      ed25519_pk: hex(epk),
    },
    recoverySk: hex(recSk),
    recoveryPk: hex(recPk),
  }
}

// Both wraps encrypt the SAME bundle:
// - passwordWrap key = Argon2id(password)
// - recoveryWrap key = sha256(recoverySk)
export async function createWraps(
  bundle: KeyBundle,
  password: string,
  recoverySkHex: string,
  salt: Uint8Array,
): Promise<Wraps> {
  const bundleData = encoder.encode(JSON.stringify(bundle))
  const passKey = await keyFromPassword(password, salt)
  const passwordWrap = await aesEncrypt(passKey, bundleData)
  const recoveryWrap = await aesEncrypt(keyFromRecovery(recoverySkHex), bundleData)
  return { passwordWrap, recoveryWrap }
}

// ==== LOGIN via password ====
export async function loginWithPassword(password: string, wrapped: string, saltHex: string): Promise<KeyBundle> {
  const wraps: Wraps = JSON.parse(wrapped)
  const salt = fromHex(saltHex)
  const passKey = await keyFromPassword(password, salt)
  const bundleData = await aesDecrypt(passKey, wraps.passwordWrap)
  return JSON.parse(decoder.decode(bundleData))
}

// ==== RECOVERY: forgot password, use recovery key ====
export async function recoverWithKey(recoverySkHex: string, wrapped: string): Promise<KeyBundle> {
  const wraps: Wraps = JSON.parse(wrapped)
  const bundleData = await aesDecrypt(keyFromRecovery(recoverySkHex), wraps.recoveryWrap)
  return JSON.parse(decoder.decode(bundleData))
}

// After recovery: rebuild passwordWrap with new password, keep recoveryWrap
export async function rebuildPasswordWrap(
  wrapped: string,
  _recoverySkHex: string,
  newPassword: string,
  newSalt: Uint8Array,
  bundle: KeyBundle,
): Promise<Wraps> {
  const old: Wraps = JSON.parse(wrapped)
  const bundleData = encoder.encode(JSON.stringify(bundle))
  const passKey = await keyFromPassword(newPassword, newSalt)
  const passwordWrap = await aesEncrypt(passKey, bundleData)
  return { passwordWrap, recoveryWrap: old.recoveryWrap }
}
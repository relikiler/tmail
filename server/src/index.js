import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { randomUUID } from 'node:crypto'
import { ethers } from 'ethers'
import db from './db.js'

const FREE_DAILY_LIMIT = 7
const PREMIUM_STORAGE_BYTES = 10 * 1024 * 1024
const PRO_STORAGE_BYTES = 100 * 1024 * 1024

const MAILBOX_ADDRESS = '0xe8a2827db1fe0667aaa659a148645a409217f3d6'
const MAILBOX_ABI = [
  'function getPlan(address user) view returns (uint256 planId, string name, uint256 expiresAt)',
]
// Lifetime Pass (ERC-721) — владение = бессрочный план Pro
const LIFETIME_PASS_ADDRESS = '0x2313D8c92D99240E34138419bC03b01769863039'
const LIFETIME_PASS_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
]
const RPC_URL = process.env.RPC_URL || 'https://polygon-bor-rpc.publicnode.com'
const RPC_FALLBACKS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://rpc.ankr.com/polygon',
  'https://1rpc.io/matic',
]

const rpcProvider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
  staticNetwork: true,
  fetchOptions: { request: { timeout: 4000 } },
})
// Lightweight fallback: retry once against the first healthy fallback RPC
const rpcFallback = new ethers.JsonRpcProvider(RPC_FALLBACKS[0], undefined, {
  staticNetwork: true,
  fetchOptions: { request: { timeout: 4000 } },
})
const mailboxContract = new ethers.Contract(MAILBOX_ADDRESS, MAILBOX_ABI, rpcProvider)
const lifetimePassContract = new ethers.Contract(LIFETIME_PASS_ADDRESS, LIFETIME_PASS_ABI, rpcProvider)

async function hasLifetimePass(address) {
  if (!address.startsWith('0x') || address.length !== 42) return false
  let bal = 0n
  for (const prov of [rpcProvider, rpcFallback]) {
    try {
      const c = new ethers.Contract(LIFETIME_PASS_ADDRESS, LIFETIME_PASS_ABI, prov)
      bal = await c.balanceOf(address)
      break
    } catch { /* try next */ }
  }
  return bal > 0n
}

async function syncPlanFromChain(address) {
  // Skip on-chain check for password-derived pseudo-addresses (they never have a Polygon plan)
  if (!address.startsWith('0x') || address.length !== 42) return null

  // Lifetime Pass → Pro forever, overrides everything (10 min cache via DB below)
  const hasPass = await hasLifetimePass(address)
  const cached = db.prepare(`SELECT plan_id, plan_expires FROM users WHERE address = ?`).get(address)
  if (hasPass) {
    // Persist as Pro with a very distant expiry so cache/cleanup treat it as active
    db.prepare(`UPDATE users SET plan_id = 'Pro', plan_expires = ? WHERE address = ?`)
      .run(2147483647000, address) // year 2038
    if (cached && cached.plan_id === 'Pro') {
      return { planId: 'Pro', planExpires: 2147483647000, active: true, lifetime: true }
    }
    return { planId: 'Pro', planExpires: 2147483647000, active: true, lifetime: true }
  }

  // Cache plan for 5 minutes to avoid RPC spam
  if (cached && cached.plan_expires && cached.plan_expires > Date.now() && cached.plan_id === 'Pro') {
    return { planId: cached.plan_id, planExpires: cached.plan_expires, active: true, lifetime: true }
  }
  if (cached && cached.plan_expires && cached.plan_expires > Date.now()) {
    return { planId: cached.plan_id, planExpires: cached.plan_expires, active: true }
  }

  try {
    let planResult = null
    for (const prov of [rpcProvider, rpcFallback]) {
      try {
        const mc = new ethers.Contract(MAILBOX_ADDRESS, MAILBOX_ABI, prov)
        planResult = await mc.getPlan(address)
        break
      } catch { /* try next */ }
    }
    if (!planResult) return null
    const [planId, name, expiresAt] = planResult
    const planName = name || 'Free'
    const expiresSec = Number(expiresAt)
    if (planId > 0 && expiresSec > Math.floor(Date.now() / 1000)) {
      db.prepare(`UPDATE users SET plan_id = ?, plan_expires = ? WHERE address = ?`)
        .run(planName, expiresSec * 1000, address)
      return { planId: planName, planExpires: expiresSec * 1000, active: true }
    }
  } catch (err) {
    // RPC error — fall back to DB value, keep existing plan
  }
  return null
}

const app = Fastify({
  logger: { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } },
  bodyLimit: 128 * 1024 * 1024
})

const ALLOWED_ORIGINS = [
  'https://195.209.212.237.nip.io',
  'https://app.tmail.io',
  'tauri://localhost',
  'http://tauri.localhost',
]
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error('Not allowed by CORS'), false)
  },
})

await app.register(rateLimit, {
  global: false,
  max: 300,
  timeWindow: '1 minute'
})

await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } })

const dayKey = () => new Date().toISOString().slice(0, 10)

function planStorage(planId) {
  if (planId === 'Pro') return PRO_STORAGE_BYTES
  if (planId === 'Premium') return PREMIUM_STORAGE_BYTES
  return 5 * 1024 * 1024
}

function isAddr(a) {
  return typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a)
}

app.post('/api/register', {
  config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
}, async (req, reply) => {
  const { address } = req.body || {}
  if (!isAddr(address)) return reply.code(400).send({ error: 'invalid address' })
  db.prepare(`INSERT OR IGNORE INTO users (address, created_at) VALUES (?, ?)`).run(address, Date.now())
  const user = db.prepare(`SELECT * FROM users WHERE address = ?`).get(address)
  return { ok: true, user }
})

app.post('/api/devices', {
  config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
}, async (req, reply) => {
  const { address, pubX25519, pubEd25519, name } = req.body || {}
  if (!isAddr(address)) return reply.code(400).send({ error: 'invalid address' })
  const user = db.prepare(`SELECT * FROM users WHERE address = ?`).get(address)
  if (!user) return reply.code(404).send({ error: 'user not registered' })
  if (typeof pubX25519 !== 'string' || pubX25519.length < 32) return reply.code(400).send({ error: 'invalid pubX25519' })
  if (typeof pubEd25519 !== 'string' || pubEd25519.length < 32) return reply.code(400).send({ error: 'invalid pubEd25519' })
  const id = randomUUID()
  db.prepare(`INSERT INTO devices (id, user_address, pub_x25519, pub_ed25519, name, created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, address, pubX25519, pubEd25519, name || 'device', Date.now())
  return { ok: true, device: { id, pubX25519, pubEd25519, name: name || 'device' } }
})

app.get('/api/devices/:addr', async (req, reply) => {
  const { addr } = req.params
  if (!isAddr(addr)) return reply.code(400).send({ error: 'invalid address' })
  const devices = db.prepare(
    `SELECT id, pub_x25519, pub_ed25519, name FROM devices WHERE user_address = ? AND revoked_at IS NULL`
  ).all(addr)
  return { address: addr, devices }
})

app.post('/api/mails', {
  config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
}, async (req, reply) => {
  const { id, from, to, ciphertext, perRecipient, attachments, sig, ts, size, immutable } = req.body || {}
  if (!isAddr(from) || !Array.isArray(to) || to.length === 0) return reply.code(400).send({ error: 'bad from/to' })
  if (!to.every(isAddr)) return reply.code(400).send({ error: 'bad to address' })
  if (typeof ciphertext !== 'string') return reply.code(400).send({ error: 'ciphertext required' })
  if (typeof perRecipient !== 'object' || perRecipient === null) return reply.code(400).send({ error: 'perRecipient required' })

  const sender = db.prepare(`SELECT * FROM users WHERE address = ?`).get(from)
  if (!sender) return reply.code(404).send({ error: 'sender not registered' })

  const chainPlan = await syncPlanFromChain(from)
  const planId = chainPlan ? chainPlan.planId : sender.plan_id

  const today = dayKey()
  db.prepare(`INSERT OR IGNORE INTO daily_limits (address, day) VALUES (?, ?)`).run(from, today)
  const used = db.prepare(`SELECT sent FROM daily_limits WHERE address = ? AND day = ?`).get(from, today)

  if (planId === 'Free' && used.sent >= FREE_DAILY_LIMIT) {
    return reply.code(429).send({ error: 'free daily limit reached (7/day)', limit: FREE_DAILY_LIMIT })
  }

  const mailSize = size || Buffer.byteLength(ciphertext, 'utf8')
  const storage = planStorage(planId)
  let total = 0
  try {
    total = db.prepare(`SELECT COALESCE(SUM(size),0) AS s FROM mails WHERE from_addr = ?`).get(from).s
  } catch { total = 0 }
  if (total + mailSize > storage) {
    return reply.code(413).send({ error: 'storage limit exceeded', limit: storage })
  }

  const mailId = id || randomUUID()
  db.prepare(`INSERT INTO mails (id, from_addr, to_addr, ts, size, ipfs_hash, ciphertext, per_recipient, sig, immutable, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(mailId, from, to.join(','), ts || Date.now(), mailSize, null, ciphertext, JSON.stringify(perRecipient), sig || null, immutable ? 1 : 0, 'delivered', Date.now())

  db.prepare(`UPDATE daily_limits SET sent = sent + 1 WHERE address = ? AND day = ?`).run(from, today)

  if (Array.isArray(attachments)) {
    const ins = db.prepare(`INSERT INTO attachments (mail_id, ipfs_cid) VALUES (?,?)`)
    for (const cid of attachments) ins.run(mailId, cid)
  }

  return { ok: true, id: mailId, status: 'delivered' }
})

app.get('/api/mails/inbox/:addr', async (req, reply) => {
  const { addr } = req.params
  if (!isAddr(addr)) return reply.code(400).send({ error: 'invalid address' })
  const list = db.prepare(
    `SELECT id, from_addr, to_addr, ts, size, status FROM mails WHERE to_addr LIKE ? ORDER BY ts DESC LIMIT 200`
  ).all(`%${addr}%`)
  return { address: addr, mails: list }
})

app.get('/api/mails/:id', async (req, reply) => {
  const { id } = req.params
  const row = db.prepare(`SELECT * FROM mails WHERE id = ?`).get(id)
  if (!row) return reply.code(404).send({ error: 'mail not found' })
  return {
    id: row.id,
    from_addr: row.from_addr,
    to_addr: row.to_addr,
    ts: row.ts,
    size: row.size,
    ipfs_hash: row.ipfs_hash,
    status: row.status,
    created_at: row.created_at,
    ciphertext: row.ciphertext,
    perRecipient: row.per_recipient ? JSON.parse(row.per_recipient) : undefined,
    sig: row.sig,
    immutable: !!row.immutable,
  }
})

app.get('/api/health', async () => ({ ok: true, ts: Date.now() }))

app.get('/api/version', async () => ({
  ok: true,
  version: '0.1.0',
  build: 1,
  bundleUrl: '',
  info: 'TMAIL mail server - blind courier',
}))

// === AUTH (passwordless on server — server stores only wrapped blob) ===
app.post('/api/auth/register', {
  config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
}, async (req, reply) => {
  const { nickname, wrapped, pubRecovery, salt, address } = req.body || {}
  if (!nickname || typeof nickname !== 'string' || !/^[a-zA-Z0-9_-]{3,32}$/.test(nickname)) {
    return reply.code(400).send({ error: 'invalid nickname (3-32 chars: a-z 0-9 _ -)' })
  }
  if (!wrapped || typeof wrapped !== 'string' || wrapped.length < 20) {
    return reply.code(400).send({ error: 'invalid wrapped blob' })
  }
  if (!pubRecovery || typeof pubRecovery !== 'string' || pubRecovery.length < 10) {
    return reply.code(400).send({ error: 'invalid pubRecovery' })
  }
  if (!salt || typeof salt !== 'string') {
    return reply.code(400).send({ error: 'invalid salt' })
  }
  const exists = db.prepare(`SELECT nickname FROM auth WHERE nickname = ?`).get(nickname)
  if (exists) return reply.code(409).send({ error: 'nickname taken' })
  db.prepare(`INSERT INTO auth (nickname, wrapped, pub_recovery, salt, address, created_at, last_seen) VALUES (?,?,?,?,?,?,?)`)
    .run(nickname, wrapped, pubRecovery, salt, address || null, Date.now(), Date.now())
  return { ok: true, nickname }
})

app.post('/api/auth/login', {
  config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
}, async (req, reply) => {
  const { nickname } = req.body || {}
  if (!nickname || typeof nickname !== 'string') return reply.code(400).send({ error: 'nickname required' })
  const row = db.prepare(`SELECT nickname, wrapped, pub_recovery, salt FROM auth WHERE nickname = ?`).get(nickname)
  if (!row) return reply.code(404).send({ error: 'nickname not found' })
  db.prepare(`UPDATE auth SET last_seen = ? WHERE nickname = ?`).run(Date.now(), nickname)
  return { ok: true, wrapped: row.wrapped, pubRecovery: row.pub_recovery, salt: row.salt }
})

// Recovery: user set a new password after proving recovery key — update passwordWrap
app.post('/api/auth/recover', {
  config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
}, async (req, reply) => {
  const { nickname, wrapped } = req.body || {}
  if (!nickname || !wrapped || typeof wrapped !== 'string' || wrapped.length < 20) {
    return reply.code(400).send({ error: 'invalid request' })
  }
  const row = db.prepare(`SELECT nickname FROM auth WHERE nickname = ?`).get(nickname)
  if (!row) return reply.code(404).send({ error: 'nickname not found' })
  db.prepare(`UPDATE auth SET wrapped = ? WHERE nickname = ?`).run(wrapped, nickname)
  return { ok: true, nickname }
})

app.post('/api/subscribe/check', async (req, reply) => {
  const { address } = req.body || {}
  if (!isAddr(address)) return reply.code(400).send({ error: 'invalid address' })
  const user = db.prepare(`SELECT * FROM users WHERE address = ?`).get(address)
  if (!user) return reply.code(404).send({ error: 'user not registered' })

  const chainPlan = await syncPlanFromChain(address)
  if (chainPlan) return { address, ...chainPlan }

  const active = user.plan_expires && user.plan_expires > Date.now()
  return {
    address,
    planId: active ? user.plan_id : 'Free',
    planExpires: user.plan_expires,
    active,
    lifetime: false
  }
})

app.post('/api/subscribe/lifetime', async (req, reply) => {
  const { address } = req.body || {}
  if (!isAddr(address)) return reply.code(400).send({ error: 'invalid address' })
  const hasPass = await hasLifetimePass(address)
  return { address, hasPass }
})

app.post('/api/upload', {
  config: { rateLimit: { max: 100, timeWindow: '1 minute' } }
}, async (req, reply) => {
  // Auth: uploader must be a registered user (address in users table).
  const addr = req.headers['x-tmail-address']
  if (!isAddr(addr)) return reply.code(401).send({ error: 'upload requires registered address' })
  if (!db.prepare(`SELECT 1 FROM users WHERE address = ?`).get(addr)) {
    return reply.code(401).send({ error: 'upload requires registered address' })
  }
  const jwt = process.env.PINATA_JWT
  if (!jwt) return reply.code(500).send({ error: 'upload not configured on server' })
  const part = await req.file?.()
  if (!part) return reply.code(400).send({ error: 'file required' })
  const form = new FormData()
  form.append('file', new Blob([await part.toBuffer()], { type: part.mimetype }), part.filename)
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  })
  if (!res.ok) return reply.code(502).send({ error: 'pinata failed: ' + res.status })
  const data = await res.json()
  return { ok: true, cid: data.IpfsHash }
})

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '127.0.0.1'

app.listen({ port: PORT, host: HOST }).then(() => {
  app.log.info(`TokenMail server on http://${HOST}:${PORT}`)
})
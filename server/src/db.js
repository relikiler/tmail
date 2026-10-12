import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(__dirname, '..', 'data'), { recursive: true })
const db = new Database(join(__dirname, '..', 'data', 'tokemail.db'))
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS auth (
  nickname    TEXT PRIMARY KEY,
  wrapped     TEXT NOT NULL,
  pub_recovery TEXT NOT NULL,
  salt        TEXT NOT NULL,
  address     TEXT,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  address     TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL DEFAULT 'Free',
  plan_expires INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  user_address TEXT NOT NULL REFERENCES users(address),
  pub_x25519 TEXT NOT NULL,
  pub_ed25519 TEXT NOT NULL,
  name       TEXT,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mails (
  id        TEXT PRIMARY KEY,
  from_addr TEXT NOT NULL,
  to_addr   TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  size      INTEGER NOT NULL,
  ipfs_hash TEXT,
  ciphertext TEXT,
  per_recipient TEXT,
  sig       TEXT,
  immutable INTEGER DEFAULT 0,
  status    TEXT NOT NULL DEFAULT 'delivered',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_id   TEXT NOT NULL REFERENCES mails(id),
  ipfs_cid  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_limits (
  address TEXT NOT NULL,
  day     TEXT NOT NULL,
  sent    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (address, day)
);
`)

// Migrations for existing DBs
const migrations = [
  `ALTER TABLE auth ADD COLUMN last_seen INTEGER`,
  `ALTER TABLE mails ADD COLUMN ciphertext TEXT`,
  `ALTER TABLE mails ADD COLUMN per_recipient TEXT`,
  `ALTER TABLE mails ADD COLUMN sig TEXT`,
  `ALTER TABLE mails ADD COLUMN immutable INTEGER DEFAULT 0`,
]
for (const sql of migrations) {
  try { db.exec(sql) } catch (e) { /* column already exists — ignore */ }
}

export default db
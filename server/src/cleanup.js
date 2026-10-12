// Cleanup policy for TMAIL:
// - Free: 90 days no login → soft-delete (mails removed, auth blob kept)
//         180 days no login → full delete (auth + devices + mails)
// - Premium/Pro: kept while subscription active (plan_expires in future)
//         after expiry + 90 days → full delete
import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const db = new Database(join(__dirname, '..', 'data', 'tokemail.db'))

const DAY = 24 * 60 * 60 * 1000
const SOFT_DAYS = 90
const FULL_DAYS = 180
const PAID_GRACE_DAYS = 90
const now = Date.now()

const authRows = db.prepare(`SELECT nickname, address, last_seen FROM auth`).all()

let softDeleted = 0
let fullyDeleted = 0

for (const row of authRows) {
  const lastSeen = row.last_seen || 0
  let planId = 'Free'
  let planExpires = 0

  if (row.address) {
    const user = db.prepare(`SELECT plan_id, plan_expires FROM users WHERE address = ?`).get(row.address)
    if (user) {
      planId = user.plan_id
      planExpires = user.plan_expires || 0
    }
  }

  if (planId !== 'Free' && planExpires > now) {
    // Paid & active — keep forever
    continue
  }

  const paidGraceUntil = planId !== 'Free' ? (planExpires + PAID_GRACE_DAYS * DAY) : 0
  const baseRef = lastSeen || row.created_at || now

  if (paidGraceUntil > now) {
    // Paid but expired — in grace period, keep
    continue
  }

  const idle = now - baseRef

  if (idle >= FULL_DAYS * DAY) {
    // Full delete
    const tx = db.transaction(() => {
      if (row.address) {
        db.prepare(`DELETE FROM devices WHERE user_address = ?`).run(row.address)
        db.prepare(`DELETE FROM daily_limits WHERE address = ?`).run(row.address)
        const mailIds = db.prepare(`SELECT id FROM mails WHERE from_addr = ? OR to_addr LIKE ?`).all(row.address, `%${row.address}%`)
        for (const m of mailIds) {
          db.prepare(`DELETE FROM attachments WHERE mail_id = ?`).run(m.id)
        }
        db.prepare(`DELETE FROM mails WHERE from_addr = ? OR to_addr LIKE ?`).run(row.address, `%${row.address}%`)
        db.prepare(`DELETE FROM users WHERE address = ?`).run(row.address)
      }
      db.prepare(`DELETE FROM auth WHERE nickname = ?`).run(row.nickname)
    })
    tx()
    fullyDeleted++
  } else if (idle >= SOFT_DAYS * DAY) {
    // Soft-delete: remove mails but keep auth blob (user could return with recovery key)
    if (row.address) {
      const tx = db.transaction(() => {
        const mailIds = db.prepare(`SELECT id FROM mails WHERE from_addr = ? OR to_addr LIKE ?`).all(row.address, `%${row.address}%`)
        for (const m of mailIds) {
          db.prepare(`DELETE FROM attachments WHERE mail_id = ?`).run(m.id)
        }
        db.prepare(`DELETE FROM mails WHERE from_addr = ? OR to_addr LIKE ?`).run(row.address, `%${row.address}%`)
        db.prepare(`DELETE FROM devices WHERE user_address = ?`).run(row.address)
      })
      tx()
    }
    softDeleted++
  }
}

console.log(`[cleanup] ${new Date().toISOString()} softDeleted=${softDeleted} fullyDeleted=${fullyDeleted} totalUsers=${authRows.length}`)
db.close()
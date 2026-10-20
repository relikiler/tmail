import { Contract } from 'ethers'
import type { Signer } from 'ethers'

export const TMAIL_ADDRESS = '0xE683F5Cb2dFB9abb6D0d460B3E49AE760903e4fA'
export const MAILBOX_ADDRESS = '0xe8a2827db1fe0667aaa659a148645a409217f3d6'
export const MAILLOG_ADDRESS = '0x6ae7773F5B9DDB4DF32DA753f820F3D7F08d0691'
export const LIFETIME_PASS_ADDRESS = '0x2313D8c92D99240E34138419bC03b01769863039'

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]

const MAILBOX_ABI = [
  'function buySubscription(uint256 planId)',
  'function getPlan(address user) view returns (uint256 planId, string name, uint256 expiresAt)',
]

const MAILLOG_ABI = [
  'function logMail(address from, address to, bytes32 mailHash, string calldata cid)',
  'event MailLogged(address indexed from, address to, bytes32 mailHash, string cid, uint256 timestamp)',
]

const LIFETIME_PASS_ABI = [
  'function buyPass() payable returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function price() view returns (uint256)',
]

export const PLANS = [
  { id: 1, name: 'Premium', price: 10n * 10n ** 18n },
  { id: 2, name: 'Pro', price: 50n * 10n ** 18n },
]

export async function getTmailBalance(signer: Signer, address: string): Promise<bigint> {
  const token = new Contract(TMAIL_ADDRESS, ERC20_ABI, signer)
  return token.balanceOf(address) as Promise<bigint>
}

export async function subscribe(signer: Signer, planId: number): Promise<{ txHash: string }> {
  const plan = PLANS.find(p => p.id === planId)
  if (!plan) throw new Error('Unknown plan')

  const token = new Contract(TMAIL_ADDRESS, ERC20_ABI, signer)
  const mailbox = new Contract(MAILBOX_ADDRESS, MAILBOX_ABI, signer)

  const allowance = await token.allowance(await signer.getAddress(), MAILBOX_ADDRESS) as bigint
  if (allowance < plan.price) {
    const approveTx = await token.approve(MAILBOX_ADDRESS, plan.price)
    await approveTx.wait()
  }

  const tx = await mailbox.buySubscription(planId)
  await tx.wait()
  return { txHash: tx.hash }
}

// ===== Immutable mode (MailLog) =====
export async function logImmutableMail(
  signer: Signer,
  from: string,
  to: string,
  mailHash: Uint8Array,
  cid: string,
): Promise<{ txHash: string }> {
  const log = new Contract(MAILLOG_ADDRESS, MAILLOG_ABI, signer)
  // mailHash (32 bytes) as hex-string argument
  const hashHex = '0x' + Array.from(mailHash).map(b => b.toString(16).padStart(2, '0')).join('')
  const tx = await log.logMail(from, to, hashHex, cid)
  await tx.wait()
  return { txHash: tx.hash }
}

// ===== Lifetime Pass (ERC-721) — 390 вечных Pro-пассов =====
export async function getLifetimePassBalance(signer: Signer, address: string): Promise<bigint> {
  const pass = new Contract(LIFETIME_PASS_ADDRESS, LIFETIME_PASS_ABI, signer)
  return pass.balanceOf(address) as Promise<bigint>
}

export async function buyLifetimePass(signer: Signer): Promise<{ txHash: string }> {
  const pass = new Contract(LIFETIME_PASS_ADDRESS, LIFETIME_PASS_ABI, signer)
  const price = await pass.price() as bigint
  const tx = await pass.buyPass({ value: price })
  await tx.wait()
  return { txHash: tx.hash }
}
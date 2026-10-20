import { BrowserProvider } from 'ethers'
import type { Signer } from 'ethers'

declare global {
  interface Window {
    ethereum?: import('ethers').Eip1193Provider
  }
}

export interface WalletState {
  address: string
  connected: boolean
  signer: Signer | null
}

export interface WcPending {
  provider: any
  uri: string
  waitSession: Promise<any>
}

const PROJECT_ID = '2beb5bde52d8d3539fbec16720e905a7'
const CHAIN_ID = 137
const CHAIN_CAIP = `eip155:${CHAIN_ID}`

let globalProvider: any = null

async function getProvider(): Promise<any> {
  if (globalProvider) return globalProvider
  const m = await import('@walletconnect/universal-provider')
  globalProvider = await m.UniversalProvider.init({
    projectId: PROJECT_ID,
    logger: 'error',
    relayUrl: 'wss://relay.walletconnect.com',
    metadata: {
      name: 'TMAIL',
      description: 'Encrypted Web3 Email on Polygon',
      url: 'https://api.tmail.io',
      icons: ['https://api.tmail.io/app/favicon.svg'],
    },
  })

  // Relay heartbeat: reconnect automatically if relay drops (single listener)
  try {
    const relayer = globalProvider.client?.core?.relayer
    if (relayer) {
      const reconnector = () => setTimeout(() => relayer.connect?.().catch(() => {}), 1000)
      relayer.removeAllListeners?.('relayer_disconnect')
      relayer.on?.('relayer_disconnect', reconnector)
    }
  } catch {}

  return globalProvider
}

export function isTauri() {
  return typeof window !== 'undefined' && !!(window as any).__TAURI__
}

export function hasMetaMask() {
  return typeof window !== 'undefined' && !!window.ethereum
}

export async function connectMetaMask(): Promise<WalletState> {
  if (!window.ethereum) throw new Error('MetaMask not installed')
  const provider = new BrowserProvider(window.ethereum)
  await provider.send('eth_requestAccounts', [])
  const signer = await provider.getSigner()
  const address = await signer.getAddress()
  return { address, connected: true, signer }
}

export async function initWalletConnect(): Promise<WcPending> {
  const provider = await getProvider()

  // Clean any stale session before new pairing
  try { if (provider.session) await provider.disconnect() } catch {}

  // Clear any previous display_uri handlers to avoid listener pile-up
  const stored = (provider as any).__tmUriHandler
  if (stored && typeof provider.removeListener === 'function') {
    try { provider.removeListener('display_uri', stored) } catch {}
  }

  const uriPromise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('QR timeout — wallet not connected, try VPN or another network')), 60000)
    const handler = (u: string) => { clearTimeout(timer); resolve(u) }
    ;(provider as any).__tmUriHandler = handler
    provider.once('display_uri', handler)
  })

  const waitSession = provider.connect({
    namespaces: {
      eip155: {
        methods: ['eth_sendTransaction', 'personal_sign', 'eth_accounts', 'eth_requestAccounts'],
        chains: [CHAIN_CAIP],
        events: ['chainChanged', 'accountsChanged'],
        rpcMap: { [CHAIN_ID]: 'https://rpc.ankr.com/polygon' },
      },
    },
  }).catch((e: any) => {
    // Force cleanup on timeout so stale sockets/streams never linger
    if (String(e?.message).includes('60000ms')) {
      try { provider.disconnect?.() } catch {}
      try { globalProvider = null } catch {}
    }
    throw new Error(e?.message || 'Connection failed')
  })

  const uri = await uriPromise
  return { provider, uri, waitSession }
}

export async function finishWalletConnect(wc: WcPending): Promise<WalletState> {
  await wc.waitSession
  const ethProvider = new BrowserProvider(wc.provider, { chainId: CHAIN_ID, name: 'polygon' })
  const signer = await ethProvider.getSigner()
  const address = await signer.getAddress()
  return { address, connected: true, signer }
}

export async function signMessage(signer: Signer, message: string): Promise<string> {
  return signer.signMessage(message)
}

export function shortenAddress(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}
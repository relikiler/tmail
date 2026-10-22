import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import type { User, MailMeta } from './api'
import { generateX25519, generateEd25519, generateEphemeralX25519, pubKeyHex, hex, fromHex, deriveSharedSecret, encryptAesGcm, decryptAesGcm, ed25519Sign, prepareSignatureData, verifyMailSignature } from './crypto'
import { connectMetaMask, initWalletConnect, finishWalletConnect, hasMetaMask, signMessage, shortenAddress } from './wallet'
import type { WcPending } from './wallet'
import QRCode from 'qrcode'
import { getContacts, addContact, removeContact } from './contacts'
import { encryptFile, uploadToIPFS, downloadFromIPFS, decryptFile } from './ipfs'
import { getTmailBalance, subscribe, getLifetimePassBalance, buyLifetimePass } from './contracts'
import { createIdentity, createWraps, loginWithPassword, recoverWithKey, rebuildPasswordWrap, hex as authHex } from './auth'
import { useToasts, ToastViewport } from './toast'
import { translations, detectLang, LANGS } from './i18n'
import type { Lang } from './i18n'
import type { Contact } from './contacts'

type Page = 'login' | 'password' | 'inbox' | 'compose' | 'settings' | 'contacts'

const NONCE_MSG = 'Sign in to SecureMail'

function App() {
  const [address, setAddress] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('login')
  const [user, setUser] = useState<User | null>(null)
  const [inbox, setInbox] = useState<MailMeta[]>([])
  const [x25519, setX25519] = useState<{ sk: string; pk: string } | null>(null)
  const [ed25519, setEd25519] = useState<{ sk: string; pk: string } | null>(null)
  const [qrPending, setQrPending] = useState<WcPending | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrConnecting, setQrConnecting] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [accountName, setAccountName] = useState<string | null>(null)
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem('tmail_lang') as Lang | null
    return saved && translations[saved] ? saved : detectLang()
  })
  const t = (k: string): string => translations[lang][k] || k
  const { toasts, error: toastError, success: toastSuccess, dismiss } = useToasts()

  useEffect(() => {
    localStorage.setItem('tmail_lang', lang)
  }, [lang])

  useEffect(() => {
    // Session (keys) lives in sessionStorage — cleared when the tab closes,
    // so private keys never persist on disk across browser restarts.
    const stored = sessionStorage.getItem('tmail_session')
    if (stored) {
      const s = JSON.parse(stored)
      setAddress(s.address)
      setX25519(s.x25519)
      setEd25519(s.ed25519)
    }
  }, [])

  const ensureRegistered = useCallback(async (addr: string) => {
    const res = await api.register(addr)
    setUser(res.user)
    if (!x25519) {
      const kx = generateX25519()
      const ke = generateEd25519()
      const xp = pubKeyHex(kx.publicKey)
      const ep = pubKeyHex(ke.publicKey)
      await api.addDevice(addr, xp, ep, 'browser')
      const state = { address: addr, x25519: { sk: hex(kx.secretKey), pk: xp }, ed25519: { sk: hex(ke.secretKey), pk: ep } }
      sessionStorage.setItem('tmail_session', JSON.stringify(state))
      setX25519(state.x25519)
      setEd25519(state.ed25519)
    }
  }, [x25519])

  const completeLogin = async (wallet: { address: string; signer: any }) => {
    await signMessage(wallet.signer, NONCE_MSG)
    await ensureRegistered(wallet.address)
    setAddress(wallet.address)
    setPage('inbox')
    loadInbox(wallet.address)
  }

  const handleMetaMask = async () => {
    if (loginBusy) return
    setLoginBusy(true)
    try {
      const wallet = await connectMetaMask()
      await completeLogin(wallet)
    } catch (e: any) {
      const msg = e?.message || ''
      if (msg.includes('rejected') || msg.includes('user denied') || msg.includes('already pending')) {
        // user cancelled — silent
      } else {
        toastError(msg)
      }
    }
    setLoginBusy(false)
  }

  const handleWCInit = async () => {
    setQrError(null)
    setQrDataUrl(null)
    setQrPending(null)
    setQrConnecting(true)
    try {
      const pending = await initWalletConnect()
      const url = await QRCode.toDataURL(pending.uri, { width: 280, margin: 4, color: { dark: '#000000', light: '#ffffff' } })
      setQrDataUrl(url)
      setQrPending(pending)
    } catch (e: any) { setQrError(e.message) }
    setQrConnecting(false)
  }

  const handleWCFinish = async () => {
    if (!qrPending) return
    setQrConnecting(true)
    try {
      const wallet = await finishWalletConnect(qrPending)
      await completeLogin(wallet)
      setQrPending(null)
      setQrDataUrl(null)
    } catch (e: any) { setQrError(e.message) }
    setQrConnecting(false)
  }

  const cancelQr = () => {
    setQrPending(null)
    setQrDataUrl(null)
    setQrError(null)
  }

  // === Password login (guest mode) ===
  const completeAuthSession = useCallback(async (bundle: any, recoverySk: string | null) => {
    const kx = { sk: bundle.x25519_sk, pk: authHex(new Uint8Array(bundle.x25519_pk.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))) }
    const ked = { sk: bundle.ed25519_sk, pk: authHex(new Uint8Array(bundle.ed25519_pk.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))) }
    // Register device on server if needed — use nickname-derived pseudo address
    const pseudoAddress = '0x' + bundle.ed25519_pk.slice(0, 40) as string
    setX25519({ sk: bundle.x25519_sk, pk: kx.pk })
    setEd25519({ sk: bundle.ed25519_sk, pk: ked.pk })
    setAddress(pseudoAddress)
    sessionStorage.setItem('tmail_session', JSON.stringify({ address: pseudoAddress, x25519: { sk: bundle.x25519_sk, pk: kx.pk }, ed25519: { sk: bundle.ed25519_sk, pk: ked.pk } }))
    try {
      await api.register(pseudoAddress)
      await api.addDevice(pseudoAddress, kx.pk, ked.pk, 'browser')
    } catch (e) { console.warn('device reg warn:', e) }
    setPage('inbox')
    setRecoveryKey(recoverySk)
    loadInbox(pseudoAddress)
  }, [])

  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)

  const handleAuthSubmit = async (mode: 'login' | 'register') => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      if (mode === 'register') {
        if (!nickname || !/^[a-zA-Z0-9_-]{3,32}$/.test(nickname)) throw new Error('Nickname: 3-32 chars (a-z, 0-9, _, -)')
        if (password.length < 6) throw new Error('Password must be at least 6 characters')
        const salt = crypto.getRandomValues(new Uint8Array(16))
        const identity = createIdentity()
        const wraps = await createWraps(identity.bundle, password, identity.recoverySk, salt)
        const wrapped = JSON.stringify(wraps)
        await api.authRegister(nickname, wrapped, identity.recoveryPk, authHex(salt))
        setAccountName(nickname)
        await completeAuthSession(identity.bundle, identity.recoverySk)
      } else {
        const blob = await api.authLogin(nickname)
        const bundle = await loginWithPassword(password, blob.wrapped, blob.salt)
        setAccountName(nickname)
        await completeAuthSession(bundle, null)
      }
    } catch (e: any) {
      setAuthError(e?.message || 'Auth failed')
    }
    setAuthBusy(false)
  }

  // === Recovery (forgot password) ===
  const [recMode, setRecMode] = useState(false)
  const [recKey, setRecKey] = useState('')
  const [recNewPass, setRecNewPass] = useState('')

  const handleRecover = async () => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      const blob = await api.authLogin(nickname)
      const bundle = await recoverWithKey(recKey, blob.wrapped)
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const newWraps = await rebuildPasswordWrap(blob.wrapped, recKey, recNewPass, salt, bundle)
      await api.authRecover(nickname, JSON.stringify(newWraps))
      await completeAuthSession(bundle, recKey)
      setRecMode(false)
    } catch (e: any) {
      setAuthError(e?.message || 'Recovery failed')
    }
    setAuthBusy(false)
  }

  const loadInbox = async (addr?: string) => {
    const a = addr || address
    if (!a) return
    const res = await api.inbox(a)
    setInbox(res.mails)
  }

  // Auto-refresh inbox every 30s while logged in
  useEffect(() => {
    if (!address) return
    const timer = setInterval(() => {
      if (page === 'inbox') loadInbox()
    }, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, page])

  const handleLogout = () => {
    if (confirm('Exit TMAIL? You can log back in with your password or wallet.')) {
      sessionStorage.removeItem('tmail_session')
      setAddress(null)
      setX25519(null)
      setEd25519(null)
      setUser(null)
      setAccountName(null)
      setPage('login')
      setInbox([])
    }
  }

  if (page === 'login' || (!address && page !== 'password')) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 20, padding: 24 }}>
        <h1 style={{ fontSize: '2.5rem' }}>{t("appName")}</h1>
        <p style={{ color: '#a1a1aa', textAlign: 'center', maxWidth: 400 }}>Encrypted Web3 email. Connect your wallet to start.</p>

        {hasMetaMask() && (
          <button className="btn btn-primary" onClick={handleMetaMask} disabled={loginBusy || qrConnecting} style={{ width: '100%', maxWidth: 320 }}>{t('loginWallet')}</button>
        )}
        <button className="btn btn-outline" onClick={handleWCInit} disabled={loginBusy || qrConnecting} style={{ width: '100%', maxWidth: 320 }}>
          {qrConnecting && !qrDataUrl ? t('sending') : t('loginWc')}
        </button>
        <div style={{ color: '#71717a', fontSize: '0.8rem', maxWidth: 320, textAlign: 'center', marginTop: -8 }}>{t('wcHint')}</div>
        <button className="btn btn-outline" onClick={() => setPage('password')} disabled={loginBusy || qrConnecting} style={{ width: '100%', maxWidth: 320 }}>🔑 {t('loginPassword')}</button>
        <p style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>{t('signIn')}</p>

        {qrError && <div style={{ color: '#ef4444', fontSize: '0.9rem', maxWidth: 320, textAlign: 'center' }}>{qrError}</div>}
        {qrDataUrl && (
          <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <div style={{ color: '#a1a1aa', fontSize: '0.9rem' }}>{t('scanWithWallet')}</div>
            <img src={qrDataUrl} alt="WalletConnect QR" width={280} height={280} style={{ borderRadius: 8 }} />
            {qrConnecting ? (
              <div style={{ color: '#8b5cf6' }}>{t('waitForWallet')}</div>
            ) : (
              <>
                <button className="btn btn-primary" onClick={handleWCFinish} style={{ width: '100%' }}>{t('connectedSign')}</button>
                <button onClick={cancelQr} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  if (page === 'password') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 16, padding: 24 }}>
        <h1 style={{ fontSize: '2.2rem' }}>{t("appName")}</h1>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <button onClick={() => { setAuthMode('login'); setAuthError(null) }} style={{ background: 'none', border: 'none', color: authMode === 'login' ? '#8b5cf6' : '#a1a1aa', cursor: 'pointer', fontSize: '1rem', fontWeight: 600 }}>Login</button>
          <span style={{ color: '#27272a' }}>|</span>
          <button onClick={() => { setAuthMode('register'); setAuthError(null) }} style={{ background: 'none', border: 'none', color: authMode === 'register' ? '#8b5cf6' : '#a1a1aa', cursor: 'pointer', fontSize: '1rem', fontWeight: 600 }}>Register</button>
        </div>
        <input placeholder={t("nicknamePlaceholder")} value={nickname} onChange={e => setNickname(e.target.value)} style={{ width: '100%', maxWidth: 320, padding: '10px 12px', background: '#18181b', border: '1px solid #27272a', borderRadius: 8, color: '#fafafa' }} />
        <input placeholder={t("passwordPlaceholder")} type="password" autoComplete="off" autoCorrect="off" spellCheck={false} value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', maxWidth: 320, padding: '10px 12px', background: '#18181b', border: '1px solid #27272a', borderRadius: 8, color: '#fafafa' }} />
        {authError && <div style={{ color: '#ef4444', fontSize: '0.9rem', maxWidth: 320, textAlign: 'center' }}>{authError}</div>}
        <button className="btn btn-primary" onClick={() => handleAuthSubmit(authMode)} disabled={authBusy} style={{ width: '100%', maxWidth: 320 }}>
          {authBusy ? 'Working...' : authMode === 'register' ? 'Create Account' : 'Login'}
        </button>
        {!recMode ? (
          <button onClick={() => { setRecMode(true); setAuthError(null) }} style={{ background: 'none', border: 'none', color: '#8b5cf6', cursor: 'pointer', fontSize: '0.85rem' }}>Forgot password? Recover with key</button>
        ) : (
          <div style={{ background: '#18181b', border: '1px solid #8b5cf6', borderRadius: 12, padding: 16, maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
            <div style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>Enter your recovery key and new password</div>
            <input placeholder={t("recoveryKey")} value={recKey} onChange={e => setRecKey(e.target.value)} style={{ padding: '10px 12px', background: '#0d0d10', border: '1px solid #27272a', borderRadius: 8, color: '#fafafa', fontFamily: 'monospace', fontSize: '0.8rem' }} />
            <input placeholder={t("newPassword")} type="password" autoComplete="off" autoCorrect="off" spellCheck={false} value={recNewPass} onChange={e => setRecNewPass(e.target.value)} style={{ padding: '10px 12px', background: '#0d0d10', border: '1px solid #27272a', borderRadius: 8, color: '#fafafa' }} />
            <button className="btn btn-primary" onClick={handleRecover} disabled={authBusy} style={{ width: '100%' }}>{authBusy ? 'Recovering...' : 'Recover Account'}</button>
            <button onClick={() => { setRecMode(false); setAuthError(null) }} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
          </div>
        )}
        {recoveryKey && (
          <div style={{ background: '#18181b', border: '1px solid #8b5cf6', borderRadius: 12, padding: 16, maxWidth: 320, fontSize: '0.85rem' }}>
            <div style={{ color: '#8b5cf6', fontWeight: 600, marginBottom: 6 }}>Save your recovery key!</div>
            <div style={{ color: '#a1a1aa', fontFamily: 'monospace', wordBreak: 'break-all' }}>{recoveryKey}</div>
            <div style={{ color: '#a1a1aa', marginTop: 6 }}>Losing it + password = losing access (E2E). Store it on paper.</div>
          </div>
        )}
        <button onClick={() => setPage('login')} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: '0.85rem' }}>← Back</button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid #27272a', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#18181b', position: 'relative' }}>
        <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{t("appName")}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>{accountName || shortenAddress(address!)}</span>
          <div className="tm-nav">
            <button onClick={() => { setPage('inbox'); loadInbox() }} style={{ background: 'none', border: 'none', color: '#fafafa', cursor: 'pointer' }}>{t('inbox')}</button>
            <button onClick={() => setPage('compose')} style={{ background: 'none', border: 'none', color: '#fafafa', cursor: 'pointer' }}>{t('compose')}</button>
            <button onClick={() => setPage('contacts')} style={{ background: 'none', border: 'none', color: '#fafafa', cursor: 'pointer' }}>{t('contacts')}</button>
            <button onClick={() => setPage('settings')} style={{ background: 'none', border: 'none', color: '#fafafa', cursor: 'pointer' }}>{t('settings')}</button>
            <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>{t('exit')}</button>
          </div>
          <button className="tm-burger" onClick={() => setNavOpen(!navOpen)} aria-label="Menu">☰</button>
          {navOpen && (
            <div className="tm-nav-mobile">
              <button onClick={() => { setPage('inbox'); loadInbox(); setNavOpen(false) }}>{t('inbox')}</button>
              <button onClick={() => { setPage('compose'); setNavOpen(false) }}>{t('compose')}</button>
              <button onClick={() => { setPage('contacts'); setNavOpen(false) }}>{t('contacts')}</button>
              <button onClick={() => { setPage('settings'); setNavOpen(false) }}>{t('settings')}</button>
              <button className="exit" onClick={() => { setNavOpen(false); handleLogout() }}>{t('exit')}</button>
            </div>
          )}
        </div>
      </header>

      <main style={{ flex: 1, padding: 24, maxWidth: 800, margin: '0 auto', width: '100%' }}>
        {page === 'inbox' && <InboxPage mails={inbox} user={address!} x25519={x25519} toastError={toastError} onAddContact={(addr) => { addContact(addr); setPage('contacts') }} t={t} />}
        {page === 'compose' && <ComposePage user={address!} x25519={x25519} ed25519={ed25519} toastError={toastError} toastSuccess={toastSuccess} t={t} />}
        {page === 'settings' && <SettingsPage user={user} address={address!} toastError={toastError} toastSuccess={toastSuccess} lang={lang} onLangChange={setLang} t={t} />}
        {page === 'contacts' && <ContactsPage toastError={toastError} t={t} />}
      </main>
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </div>
  )
}

function InboxPage({ mails, user, x25519, toastError, onAddContact, t }: { mails: MailMeta[]; user: string; x25519: { sk: string; pk: string } | null; toastError: (s: string) => void; onAddContact: (addr: string) => void; t: (k: string) => string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<{ cid: string; name: string; size: number; key: string }[]>([])
  const [immutable, setImmutable] = useState(false)
  const [sigValid, setSigValid] = useState<boolean | null>(null)

  const openMail = async (id: string) => {
    setSelected(id)
    setBody('')
    setAttachments([])
    setImmutable(false)
    try {
      const mail = await api.getMail(id)
      setImmutable(!!mail.immutable)
      if (!x25519 || !mail.perRecipient || !mail.perRecipient[user]) {
        setBody('(cannot decrypt — no key for this device)')
        return
      }
      // Verify ed25519 signature over the ciphertext before decrypting (E2E integrity).
      // Sender's ed25519 public key is fetched from their registered devices.
      let sigValid = false
      try {
        const fullCipher = mail.ciphertext!
        const dot = fullCipher.lastIndexOf('.')
        const ctPart = fullCipher.slice(0, dot)
        const devs = await api.getDevices(mail.from_addr)
        const senderEd = devs.devices?.[0]?.pub_ed25519
        const mailSig = mail.sig ? fromHex(mail.sig) : null
        if (senderEd && mailSig && mail.ts) {
          sigValid = verifyMailSignature(mail.from_addr, [user], ctPart, mail.ts, mail.sig!, senderEd)
        }
      } catch { /* sig check non-fatal: still try to decrypt */ }

      const ephPub = fromHex(mail.perRecipient[user])
      const shared = deriveSharedSecret(fromHex(x25519.sk), ephPub)
      const dot = mail.ciphertext!.lastIndexOf('.')
      const ct = mail.ciphertext!.slice(0, dot)
      const nonce = mail.ciphertext!.slice(dot + 1)
      const dec = await decryptAesGcm(shared, { ephemeralPubkey: '', nonce, ciphertext: ct })
      setSigValid(sigValid)
      try {
        const parsed = JSON.parse(dec)
        setBody(parsed.body || dec)
        setAttachments(parsed.attachments || [])
      } catch {
        setBody(dec)
      }
    } catch { setBody('decryption failed') }
  }

  const downloadAttach = async (a: { cid: string; name: string; key: string }) => {
    try {
      const blob = await downloadFromIPFS(a.cid)
      const decrypted = await decryptFile(blob, a.key)
      const url = URL.createObjectURL(decrypted)
      const link = document.createElement('a')
      link.href = url
      link.download = a.name
      link.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { toastError('Download failed: ' + e.message) }
  }

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>{t('inbox')} ({mails.length})</h2>
      {mails.length === 0 && <p style={{ color: '#a1a1aa' }}>{t('noMessages')}</p>}
      {mails.map(m => (
        <div key={m.id}>
          <div onClick={() => openMail(m.id)} style={{ padding: '12px 16px', borderBottom: '1px solid #27272a', cursor: 'pointer', background: selected === m.id ? '#27272a' : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{shortenAddress(m.from_addr)}</div>
              <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>{new Date(m.ts).toLocaleString()} · {m.size} bytes</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onAddContact(m.from_addr) }} style={{ background: 'none', border: '1px solid #27272a', borderRadius: 6, padding: '4px 10px', color: '#a1a1aa', cursor: 'pointer', fontSize: '0.8rem' }}>+ Contact</button>
          </div>
          {selected === m.id && (
            <div style={{ marginTop: 12, padding: 16, background: '#18181b', borderRadius: 8 }}>
              {sigValid !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '6px 10px', background: sigValid ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', border: `1px solid ${sigValid ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`, borderRadius: 8, fontSize: '0.8rem', color: sigValid ? '#34d399' : '#f87171' }}>
                  {sigValid ? '✓ Signature verified (E2E)' : '✗ Signature invalid'}
                </div>
              )}
              {immutable && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '6px 10px', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 8, fontSize: '0.8rem', color: '#c4b5fd' }}>
                  ⛓️ Immutable — record on Polygon (hash + CID)
                </div>
              )}
              <div style={{ whiteSpace: 'pre-wrap' }}>{body}</div>
              {attachments.length > 0 && (
                <div style={{ marginTop: 16, borderTop: '1px solid #27272a', paddingTop: 12 }}>
                  <div style={{ color: '#a1a1aa', fontSize: '0.85rem', marginBottom: 8 }}>Attachments ({attachments.length})</div>
                  {attachments.map((a, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                      <span style={{ fontSize: '0.85rem', color: '#fafafa' }}>📎 {a.name} ({(a.size / 1024).toFixed(1)} KB)</span>
                      <button onClick={() => downloadAttach(a)} style={{ background: 'none', border: '1px solid #8b5cf6', borderRadius: 6, padding: '4px 10px', color: '#8b5cf6', cursor: 'pointer', fontSize: '0.8rem' }}>Download</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ContactsPage({ toastError, t }: { toastError: (s: string) => void; t: (k: string) => string }) {
  const [contacts, setContacts] = useState<Contact[]>(getContacts)
  const [addr, setAddr] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const addAddr = () => {
    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) { toastError('Invalid address'); return }
    const updated = addContact(addr)
    setContacts(updated)
    setAddr('')
  }

  const remove = (a: string) => { setContacts(removeContact(a)); setConfirmRemove(null) }

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>{t('contacts')} ({contacts.length})</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input placeholder="0x… address" value={addr} onChange={e => setAddr(e.target.value)} style={{ flex: 1, padding: '10px 12px', background: '#18181b', border: '1px solid #27272a', borderRadius: 8, color: '#fafafa' }} />
        <button onClick={addAddr} className="btn btn-primary">{t('add')}</button>
      </div>
      {contacts.map(c => (
        <div key={c.address} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #27272a' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: '0.85rem', color: '#a1a1aa', fontFamily: 'monospace' }}>{shortenAddress(c.address)}</div>
          </div>
          {confirmRemove === c.address ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: '#a1a1aa', fontSize: '0.8rem' }}>Delete?</span>
              <button onClick={() => remove(c.address)} style={{ background: 'none', border: '1px solid #ef4444', borderRadius: 6, padding: '4px 10px', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem' }}>Yes</button>
              <button onClick={() => setConfirmRemove(null)} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: '0.8rem' }}>No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmRemove(c.address)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.85rem' }}>Remove</button>
          )}
        </div>
      ))}
    </div>
  )
}

function ComposePage({ user, x25519, ed25519, toastError, toastSuccess, t }: { user: string; x25519: { sk: string; pk: string } | null; ed25519: { sk: string; pk: string } | null; toastError: (s: string) => void; toastSuccess: (s: string) => void; t: (k: string) => string }) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<{ file: File }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [immutable, setImmutable] = useState(false)

  const addFiles = (files: FileList) => {
    setAttachments(prev => [...prev, ...Array.from(files).map(f => ({ file: f }))])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files)
  }

  const removeAttach = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  const send = async () => {
    if (!to || !bodyText || !x25519 || !ed25519) return

    // Immutable mode requires a connected wallet (on-chain record)
    if (immutable && !hasMetaMask()) {
      toastError('Immutable mode requires a wallet. Connect MetaMask (or WalletConnect) first.')
      return
    }

    setSending(true)
    try {
      const recipientDevices = await api.getDevices(to)
      if (recipientDevices.devices.length === 0) { toastError('Recipient has no registered devices'); setSending(false); return }

      const fileAttachments: { cid: string; name: string; size: number; key: string }[] = []
      for (const a of attachments) {
        const { encrypted, key } = await encryptFile(a.file)
        const cid = await uploadToIPFS(encrypted, user)
        fileAttachments.push({ cid, name: a.file.name, size: a.file.size, key })
      }

      const eph = generateEphemeralX25519()
      const recipientPub = fromHex(recipientDevices.devices[0].pub_x25519)
      const shared = deriveSharedSecret(eph.secretKey, recipientPub)
      const bodyPayload = { subject, body: bodyText, attachments: fileAttachments }
      const encrypted = await encryptAesGcm(shared, JSON.stringify(bodyPayload))
      const perRecipient: Record<string, string> = {}
      perRecipient[to] = pubKeyHex(eph.publicKey)

      const fullCipher = encrypted.ciphertext + '.' + encrypted.nonce
      const cipherHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fullCipher))))
      const ts = Date.now()
      const sigData = prepareSignatureData(user, [to], cipherHash, ts)
      const sig = ed25519Sign(fromHex(ed25519.sk), sigData)

      await api.sendMail({
        id: crypto.randomUUID(),
        from: user,
        to: [to],
        ciphertext: fullCipher,
        perRecipient,
        sig: hex(sig),
        ts,
        size: encrypted.ciphertext.length / 2,
        immutable: immutable ? 1 : 0,
      })

      // Immutable mode: store hash + CID of the encrypted body on-chain
      if (immutable) {
        try {
          const { connectMetaMask } = await import('./wallet')
          const wallet = await connectMetaMask()
          if (wallet.signer) {
            const { logImmutableMail } = await import('./contracts')
            // Hash of the FULL encrypted payload (ciphertext.nonce)
            const payloadBytes = new TextEncoder().encode(encrypted.ciphertext + '.' + encrypted.nonce)
            const payloadHash = new Uint8Array(await crypto.subtle.digest('SHA-256', payloadBytes))
            const cid = await (async () => {
              // Upload encrypted body to IPFS first
              const { encryptFile, uploadToIPFS } = await import('./ipfs')
              const blob = new Blob([encrypted.ciphertext], { type: 'application/octet-stream' })
              const file = new File([blob], 'mail.enc')
              const { encrypted: encBlob } = await encryptFile(file)
              return uploadToIPFS(encBlob, user)
            })()
            const { txHash } = await logImmutableMail(wallet.signer, user, to, payloadHash, cid)
            toastSuccess(`Immutable: recorded on-chain (${txHash.slice(0, 10)}...)`)
          }
        } catch (e: any) {
          toastError('Mail sent, but immutable log failed: ' + e.message)
        }
      }

      toastSuccess('Sent!')
      setTo(''); setSubject(''); setBodyText(''); setAttachments([]); setImmutable(false)
    } catch (e: any) { toastError(e.message) }
    setSending(false)
  }

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>{t('compose')}</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input placeholder={t("toPlaceholder")} value={to} onChange={e => setTo(e.target.value)} style={{ flex: 1, padding: '10px 12px', background: '#18181b', border: '1px solid #27272a', borderRadius: 8, color: '#fafafa' }} />
        <details style={{ position: 'relative' }}>
          <summary style={{ padding: '10px 12px', background: '#18181b', border: '1px solid #27272a', borderRadius: 8, cursor: 'pointer', color: '#a1a1aa', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>From contacts</summary>
          <div style={{ position: 'absolute', top: '100%', right: 0, background: '#18181b', border: '1px solid #27272a', borderRadius: 8, minWidth: 250, maxHeight: 200, overflowY: 'auto', zIndex: 10, marginTop: 4 }}>
            {getContacts().map(c => (
              <div key={c.address} onClick={() => setTo(c.address)} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #27272a', color: '#fafafa' }}>
                <div style={{ fontWeight: 500 }}>{c.label}</div>
                <div style={{ fontSize: '0.8rem', color: '#a1a1aa', fontFamily: 'monospace' }}>{shortenAddress(c.address)}</div>
              </div>
            ))}
            {getContacts().length === 0 && <div style={{ padding: '10px 12px', color: '#a1a1aa', fontSize: '0.85rem' }}>{t('noContacts')}</div>}
          </div>
        </details>
      </div>
      <input placeholder={t("subjectPlaceholder")} value={subject} onChange={e => setSubject(e.target.value)} style={{ width: '100%', padding: '10px 12px', marginBottom: 12, background: '#18181b', border: '1px solid #27272a', borderRadius: 8, color: '#fafafa' }} />
      <textarea placeholder={t("bodyPlaceholder")} value={bodyText} onChange={e => setBodyText(e.target.value)} rows={8} style={{ width: '100%', padding: '10px 12px', marginBottom: 12, background: '#18181b', border: '1px solid #27272a', borderRadius: 8, color: '#fafafa', resize: 'vertical' }} />
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        style={{ border: `2px dashed ${dragOver ? '#8b5cf6' : '#27272a'}`, borderRadius: 8, padding: 20, textAlign: 'center', marginBottom: 12, cursor: 'pointer', transition: '0.2s', background: dragOver ? 'rgba(139,92,246,0.05)' : 'transparent' }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        {attachments.length === 0 ? <span style={{ color: '#a1a1aa' }}>📎 Drop files here or click to attach</span> : <span style={{ color: '#a1a1aa' }}>{attachments.length} file(s) attached — click to add more</span>}
        <input id="file-input" type="file" multiple onChange={handleFileInput} style={{ display: 'none' }} />
      </div>
      {attachments.map((a, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', background: '#18181b', borderRadius: 6, marginBottom: 6 }}>
          <span style={{ color: '#a1a1aa', fontSize: '0.85rem', fontFamily: 'monospace' }}>📎 {a.file.name} ({(a.file.size / 1024).toFixed(1)} KB)</span>
          <button onClick={() => removeAttach(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.85rem' }}>Remove</button>
        </div>
      ))}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', color: '#a1a1aa', fontSize: '0.9rem' }}>
        <input type="checkbox" checked={immutable} onChange={e => setImmutable(e.target.checked)} style={{ accentColor: '#8b5cf6', width: 16, height: 16 }} />
        Immutable — record hash + CID on-chain (Polygon, ~$0.01 gas)
      </label>
      <button className="btn btn-primary" onClick={send} disabled={sending}>{sending ? 'Sending...' : 'Send Encrypted'}</button>
    </div>
  )
}

function SettingsPage({ user, address, toastError, toastSuccess, lang, onLangChange, t }: { user: User | null; address: string; toastError: (s: string) => void; toastSuccess: (s: string) => void; lang: Lang; onLangChange: (l: Lang) => void; t: (k: string) => string }) {
  const [plan, setPlan] = useState<string>(user?.plan_id || 'Free')
  const [balance, setBalance] = useState<string>('')
  const [lifetime, setLifetime] = useState<boolean>(false)
  const [lifetimeBusy, setLifetimeBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!address) return
    api.checkSubscription(address).then(r => {
      setPlan(r.planId)
      if (r.lifetime) setLifetime(true)
    }).catch(() => {})
    if (hasMetaMask()) {
      connectMetaMask().then(async w => {
        if (w.signer) {
          const bal = await getTmailBalance(w.signer, address)
          setBalance((Number(bal) / 1e18).toFixed(2))
          const pb = await getLifetimePassBalance(w.signer, address).catch(() => 0n)
          if (pb > 0n) setLifetime(true)
        }
      }).catch(() => {})
    }
  }, [address])

  const buy = async (planId: number) => {
    setBusy(true)
    try {
      if (!hasMetaMask()) { toastError(t('metaMaskRequired')); return }
      const w = await connectMetaMask()
      if (!w.signer) throw new Error('No signer')
      const { txHash } = await subscribe(w.signer, planId)
      toastSuccess(`Subscription paid! TX: ${txHash.slice(0, 10)}...`)
      await api.register(address)
      const res = await api.checkSubscription(address)
      setPlan(res.planId)
    } catch (e: any) { toastError(e.message || 'Subscription failed') }
    setBusy(false)
  }

  const buyPass = async () => {
    setLifetimeBusy(true)
    try {
      if (!hasMetaMask()) { toastError(t('metaMaskRequired')); return }
      const w = await connectMetaMask()
      if (!w.signer) throw new Error('No signer')
      const { txHash } = await buyLifetimePass(w.signer)
      toastSuccess(`Lifetime Pass bought! TX: ${txHash.slice(0, 10)}...`)
      await api.register(address)
      setLifetime(true)
      const res = await api.checkSubscription(address)
      setPlan(res.planId)
    } catch (e: any) { toastError(e.message || 'Lifetime Pass purchase failed') }
    setLifetimeBusy(false)
  }

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>{t('settings')}</h2>
      <div style={{ background: '#18181b', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>{t('address')}</div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{address}</div>
      </div>
      <div style={{ background: '#18181b', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>{t('plan')}</div>
        <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{plan}</div>
        {lifetime && <div style={{ color: '#10b981', fontSize: '0.85rem', marginTop: 4 }}>Lifetime Pass ✓</div>}
        {balance && <div style={{ color: '#a1a1aa', fontSize: '0.85rem', marginTop: 4 }}>TMAIL balance: {balance}</div>}
      </div>
      <div style={{ background: '#18181b', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ color: '#a1a1aa', fontSize: '0.85rem', marginBottom: 12 }}>Lifetime Pass (вечный Pro)</div>
        {lifetime ? (
          <div style={{ color: '#10b981' }}>Вы владеете Lifetime Pass — Pro бессрочно ✓</div>
        ) : (
          <button className="btn btn-primary" onClick={buyPass} disabled={lifetimeBusy}>
            {lifetimeBusy ? 'Buying...' : 'Buy Lifetime Pass ($80 POL, on-chain once)'}
          </button>
        )}
        <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginTop: 8 }}>1 покупка = вечный Premium/Pro. Polygonscan: 0x2313…63039</div>
      </div>
      <div style={{ background: '#18181b', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ color: '#a1a1aa', fontSize: '0.85rem', marginBottom: 12 }}>{t('upgrade')}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={() => buy(1)} disabled={busy}>{t('premium')}</button>
          <button className="btn btn-outline" onClick={() => buy(2)} disabled={busy}>{t('pro')}</button>
        </div>
        <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginTop: 8 }}>{t('polygonNote')}</div>
      </div>
      <div style={{ background: '#18181b', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ color: '#a1a1aa', fontSize: '0.85rem', marginBottom: 8 }}>{t('language')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => onLangChange(l.code)}
              style={{
                background: lang === l.code ? '#8b5cf6' : '#0d0d10',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '6px 12px',
                color: lang === l.code ? '#fff' : '#a1a1aa',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >{l.native}</button>
          ))}
        </div>
      </div>
      <div style={{ background: '#18181b', borderRadius: 12, padding: 20 }}>
        <div style={{ color: '#a1a1aa', fontSize: '0.85rem' }}>{t('security')}</div>
        <div style={{ fontSize: '0.9rem', color: '#a1a1aa', marginTop: 8 }}>{t('securityDesc')}</div>
      </div>
    </div>
  )
}

export default App
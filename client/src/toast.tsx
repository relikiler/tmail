import { useState, useCallback, useRef } from 'react'

export interface Toast {
  id: number
  text: string
  type: 'info' | 'error' | 'success'
}

let seq = 0

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: number) => {
    setToasts(t => t.filter(x => x.id !== id))
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id] }
  }, [])

  const show = useCallback((text: string, type: Toast['type'] = 'info', duration = 4000) => {
    const id = ++seq
    setToasts(t => [...t, { id, text, type }])
    timers.current[id] = setTimeout(() => dismiss(id), duration)
  }, [dismiss])

  const error = useCallback((text: string) => show(text, 'error', 5000), [show])
  const success = useCallback((text: string) => show(text, 'success', 3500), [show])

  return { toasts, show, error, success, dismiss }
}

export function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 340 }}>
      {toasts.map(t => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          style={{
            background: t.type === 'error' ? '#3b0a0a' : t.type === 'success' ? '#0a3b1a' : '#18181b',
            border: `1px solid ${t.type === 'error' ? '#ef4444' : t.type === 'success' ? '#22c55e' : '#27272a'}`,
            color: '#fafafa',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: '0.9rem',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
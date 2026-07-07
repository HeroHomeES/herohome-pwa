import { useEffect, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface ToastState {
  type: ToastType
  message: string
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const showToast = (type: ToastType, message: string) => setToast({ type, message })

  return { showToast, toast }
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null

  const colors = {
    success: 'bg-teal text-white',
    error: 'bg-error text-white',
    info: 'bg-violet text-white',
  }

  const icons = { success: '✓', error: '✕', info: 'ℹ' }

  return (
    <div className={`fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-[10px] text-sm font-medium ${colors[toast.type]}`}>
      <span className="font-bold">{icons[toast.type]}</span>
      {toast.message}
    </div>
  )
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white border border-line rounded-xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-line-subtle">
          <h3 className="text-base font-semibold tracking-[-0.02em] text-ink">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface text-lg leading-none"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

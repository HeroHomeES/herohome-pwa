import { useId } from 'react'

// Símbolo "Pulse" — DESIGN.md v3.0. Dos barras verticales con gradiente violeta;
// la derecha más corta y desplazada abajo (asimetría intencional, no "corregir").

export function HerohomeSymbol({ size = 24, onViolet = false }: {
  size?: number
  /** Sobre fondo violeta las barras van en blanco semitransparente, sin gradiente. */
  onViolet?: boolean
}) {
  const uid = useId().replace(/:/g, '')

  if (onViolet) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <rect x="10" y="6" width="12" height="52" rx="5" fill="rgba(255,255,255,0.9)" />
        <rect x="30" y="18" width="12" height="40" rx="5" fill="rgba(255,255,255,0.65)" />
      </svg>
    )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}l`} x1="0" y1="6" x2="0" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A5A6FF" />
          <stop offset="100%" stopColor="#3C3ECC" />
        </linearGradient>
        <linearGradient id={`${uid}r`} x1="0" y1="18" x2="0" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5B5CFF" />
          <stop offset="100%" stopColor="#282999" />
        </linearGradient>
      </defs>
      <rect x="10" y="6" width="12" height="52" rx="5" fill={`url(#${uid}l)`} />
      <rect x="30" y="18" width="12" height="40" rx="5" fill={`url(#${uid}r)`} />
    </svg>
  )
}

/** Lockup horizontal: símbolo + wordmark. `dark` = wordmark claro para fondos oscuros. */
export function HerohomeLogo({ size = 22, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <span className="inline-flex items-center" style={{ gap: size * 0.45 }}>
      <HerohomeSymbol size={size} />
      <span
        className={`font-semibold tracking-[-0.03em] leading-none ${dark ? 'text-[#F8FAFC]' : 'text-ink'}`}
        style={{ fontSize: size * 0.7 }}
      >
        Herohome
      </span>
    </span>
  )
}

import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { HerohomeSymbol } from '../components/HerohomeLogo'
import { IconMail } from '../components/icons'

const NOT_A_CLIENT_ERROR =
  'Su email no aparece como cliente de Herohome. Póngase en contacto con nosotros en hola@herohome.es'
const MAGIC_LINK_ERROR = 'El enlace de acceso ha caducado o no es válido. Solicita uno nuevo.'
const GENERIC_ERROR = 'No se pudo enviar el enlace. Inténtalo de nuevo.'

export default function LoginPage() {
  const { session, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'magiclink' ? MAGIC_LINK_ERROR : null
  )

  if (!loading && session) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const trimmedEmail = email.trim()

    const { data: exists, error: lookupError } = await supabase.rpc('check_user_exists_by_email', {
      p_email: trimmedEmail,
    })

    if (lookupError) {
      setError(GENERIC_ERROR)
      setSubmitting(false)
      return
    }

    if (!exists) {
      setError(NOT_A_CLIENT_ERROR)
      setSubmitting(false)
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (error) {
      setError(GENERIC_ERROR)
    } else {
      setSent(true)
    }

    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-6 relative">
      {/* Gradiente sutil superior (estética Stripe) */}
      <div
        className="absolute inset-x-0 top-0 h-[45%] pointer-events-none"
        style={{ background: 'radial-gradient(80% 100% at 50% 0%, rgba(91,92,255,0.09) 0%, rgba(91,92,255,0) 100%)' }}
      />

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="mb-10 flex flex-col items-center text-center">
          <HerohomeSymbol size={60} />
          <span className="mt-4 text-[22px] font-semibold tracking-[-0.03em] text-ink">Herohome</span>
          <p className="mt-1.5 text-sm text-slate">Portal del vendedor</p>
        </div>

        {sent ? (
          <div className="bg-white border border-line rounded-xl p-6 text-center">
            <span className="mx-auto w-12 h-12 rounded-full bg-violet-light text-violet-dark flex items-center justify-center mb-4">
              <IconMail size={22} />
            </span>
            <h2 className="text-lg font-semibold text-ink mb-2">Revisa tu email</h2>
            <p className="text-sm text-slate leading-relaxed">
              Hemos enviado un enlace de acceso a <strong className="text-ink">{email}</strong>. Pulsa el enlace para entrar.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-[11px] font-semibold text-slate tracking-[0.02em]">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full rounded-[9px] border border-line px-4 py-3 text-base text-ink bg-white placeholder-slate-light focus:outline-none focus:border-violet focus:ring-[3px] focus:ring-violet/12"
              />
            </div>

            {error && (
              <p className="text-sm text-error">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full bg-violet hover:bg-violet-dark text-white font-medium py-3 rounded-[9px] text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition"
            >
              {submitting ? 'Enviando...' : 'Enviar enlace de acceso'}
            </button>

            <p className="text-xs text-slate-light text-center leading-relaxed mt-2">
              Sin contraseñas. Te enviamos un enlace<br />y entras con un toque.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

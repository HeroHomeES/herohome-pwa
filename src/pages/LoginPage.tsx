import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

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
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-10 text-center">
          <span className="text-3xl font-bold text-[#2E5EA1]">Herohome</span>
          <p className="mt-2 text-sm text-[#666666]">Portal del vendedor</p>
        </div>

        {sent ? (
          <div className="bg-[#F8F9FA] rounded-2xl p-6 text-center">
            <div className="text-4xl mb-4">📧</div>
            <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">Revisa tu email</h2>
            <p className="text-sm text-[#666666]">
              Hemos enviado un enlace de acceso a <strong>{email}</strong>. Pulsa el enlace para entrar.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-sm font-medium text-[#1A1A1A]">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-[#1A1A1A] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2E5EA1] focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-sm text-[#DC3545]">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full bg-[#2E5EA1] text-white font-semibold py-3 rounded-xl text-base disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              {submitting ? 'Enviando...' : 'Enviar enlace de acceso'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

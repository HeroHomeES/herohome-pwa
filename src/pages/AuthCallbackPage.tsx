import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function AuthCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    let resolved = false

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !resolved) {
        resolved = true
        navigate('/', { replace: true })
      }
    })

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        navigate('/login?error=magiclink', { replace: true })
      }
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-violet border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

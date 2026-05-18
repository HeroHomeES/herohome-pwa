import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { Property } from '../lib/types'

export function useProperty() {
  const { user } = useAuth()
  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return

    supabase
      .from('properties')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setError(error.code === 'PGRST116' ? 'no_property' : error.message)
        } else {
          setProperty(data as Property)
        }
        setLoading(false)
      })
  }, [user])

  const saveProperty = async (updates: Partial<Property>): Promise<{ error: string | null }> => {
    if (!property) return { error: 'No hay propiedad cargada' }

    const { error } = await supabase
      .from('properties')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', property.id)

    if (error) return { error: error.message }

    setProperty({ ...property, ...updates, updated_at: new Date().toISOString() })
    return { error: null }
  }

  return { property, loading, error, saveProperty }
}

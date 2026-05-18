import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { AvailabilityDay } from '../lib/types'

const DEFAULT_CONFIG: AvailabilityDay[] = Array.from({ length: 7 }, (_, i) => ({
  day_of_week: i,
  from_hour: 10,
  to_hour: 14,
  is_active: i < 5,
}))

export function useAvailability(propertyId: string | null) {
  const [config, setConfig] = useState<AvailabilityDay[]>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)

  const loadConfig = useCallback(async () => {
    if (!propertyId) { setLoading(false); return }

    const { data, error } = await supabase
      .from('availability_config')
      .select('config')
      .eq('property_id', propertyId)
      .single()

    if (!error && data) {
      const sorted = [...(data.config as AvailabilityDay[])].sort((a, b) => a.day_of_week - b.day_of_week)
      setConfig(sorted)
    }
    setLoading(false)
  }, [propertyId])

  useEffect(() => { loadConfig() }, [loadConfig])

  const saveConfig = async (): Promise<{ error: string | null }> => {
    if (!propertyId) return { error: 'No hay propiedad' }

    const { error } = await supabase
      .from('availability_config')
      .upsert(
        { property_id: propertyId, config, updated_at: new Date().toISOString() },
        { onConflict: 'property_id' }
      )

    return { error: error?.message ?? null }
  }

  return { config, setConfig, loading, saveConfig }
}

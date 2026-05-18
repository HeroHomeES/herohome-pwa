import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { VisitSlot } from '../lib/types'

export function useVisits(propertyId: string | null) {
  const [pending, setPending] = useState<VisitSlot[]>([])
  const [upcoming, setUpcoming] = useState<VisitSlot[]>([])
  const [loading, setLoading] = useState(true)

  const loadVisits = useCallback(async () => {
    if (!propertyId) { setLoading(false); return }

    const [pendingRes, upcomingRes] = await Promise.all([
      supabase
        .from('visit_slots')
        .select('*')
        .eq('property_id', propertyId)
        .eq('status', 'Pending to confirm')
        .order('start_time'),
      supabase
        .from('visit_slots')
        .select('*')
        .eq('property_id', propertyId)
        .eq('status', 'Confirmed')
        .gte('start_time', new Date().toISOString())
        .order('start_time'),
    ])

    setPending((pendingRes.data ?? []) as VisitSlot[])
    setUpcoming((upcomingRes.data ?? []) as VisitSlot[])
    setLoading(false)
  }, [propertyId])

  useEffect(() => { loadVisits() }, [loadVisits])

  const confirmVisit = async (id: string): Promise<{ error: string | null }> => {
    const { error } = await supabase
      .from('visit_slots')
      .update({ status: 'Confirmed', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) loadVisits()
    return { error: error?.message ?? null }
  }

  const cancelVisit = async (id: string): Promise<{ error: string | null }> => {
    const { error } = await supabase
      .from('visit_slots')
      .update({ status: 'Canceled by owner', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) loadVisits()
    return { error: error?.message ?? null }
  }

  const requestReschedule = async (visit: VisitSlot): Promise<{ error: string | null }> => {
    const hoursUntil = (new Date(visit.start_time).getTime() - Date.now()) / (1000 * 60 * 60)
    if (hoursUntil < 24) {
      return { error: 'No se puede reagendar con menos de 24h de antelación' }
    }
    const { error } = await supabase
      .from('visit_slots')
      .update({ status: 'Canceled by owner', updated_at: new Date().toISOString() })
      .eq('id', visit.id)
    if (!error) loadVisits()
    return { error: error?.message ?? null }
  }

  return { pending, upcoming, loading, confirmVisit, cancelVisit, requestReschedule }
}

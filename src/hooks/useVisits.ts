import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { invokeEdgeFunction } from '../lib/edgeFunctions'
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

  // Las acciones del propietario sobre visitas pasan por la Edge Function
  // manage-visit (fuente única, verifica propiedad y avisa al PC vía notify-visit).
  const confirmVisit = async (id: string): Promise<{ error: string | null }> => {
    const res = await invokeEdgeFunction('manage-visit', { visit_slot_id: id, action: 'confirm' })
    if (!res.ok) return { error: res.error ?? 'No se pudo confirmar la visita' }
    loadVisits()
    return { error: null }
  }

  const cancelVisit = async (id: string): Promise<{ error: string | null }> => {
    const res = await invokeEdgeFunction('manage-visit', { visit_slot_id: id, action: 'cancel' })
    if (!res.ok) return { error: res.error ?? 'No se pudo cancelar la visita' }
    loadVisits()
    return { error: null }
  }

  const requestReschedule = async (visit: VisitSlot): Promise<{ error: string | null }> => {
    const hoursUntil = (new Date(visit.start_time).getTime() - Date.now()) / (1000 * 60 * 60)
    if (hoursUntil < 24) {
      return { error: 'No se puede reagendar con menos de 24h de antelación' }
    }
    const res = await invokeEdgeFunction('manage-visit', { visit_slot_id: visit.id, action: 'cancel' })
    if (!res.ok) return { error: res.error ?? 'No se pudo reagendar la visita' }
    loadVisits()
    return { error: null }
  }

  return { pending, upcoming, loading, confirmVisit, cancelVisit, requestReschedule }
}

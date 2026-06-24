import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { invokeEdgeFunction } from '../lib/edgeFunctions'
import type { Offer } from '../lib/types'

// Columnas visibles para el propietario (CV). NO se exponen buyer_dni ni
// buyer_email: son datos del comprador que gestiona el equipo Herohome para el
// contrato de arras (ver SQL de privacidad: GRANT a nivel de columna).
const OFFER_COLUMNS =
  'id, property_id, parent_offer_id, initiated_by, buyer_name, buyer_phone, amount, status, created_at, updated_at'

export function useOffers(propertyId: string | null) {
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)

  const loadOffers = useCallback(async () => {
    if (!propertyId) { setLoading(false); return }

    const { data } = await supabase
      .from('offers')
      .select(OFFER_COLUMNS)
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })

    setOffers((data ?? []) as Offer[])
    setLoading(false)
  }, [propertyId])

  useEffect(() => { loadOffers() }, [loadOffers])

  // Las decisiones del propietario pasan SIEMPRE por la Edge Function
  // manage-offer (actualiza la tabla y avisa al comprador). El cliente ya no
  // escribe directo en `offers`.
  const acceptOffer = async (id: string): Promise<{ error: string | null }> => {
    const { ok, error } = await invokeEdgeFunction('manage-offer', { offer_id: id, action: 'accept' })
    if (ok) loadOffers()
    return { error: ok ? null : (error ?? 'No se pudo aceptar la oferta') }
  }

  const denyOffer = async (id: string): Promise<{ error: string | null }> => {
    const { ok, error } = await invokeEdgeFunction('manage-offer', { offer_id: id, action: 'deny' })
    if (ok) loadOffers()
    return { error: ok ? null : (error ?? 'No se pudo rechazar la oferta') }
  }

  const counterOffer = async (
    parentId: string,
    amount: number,
    _propId: string,
  ): Promise<{ error: string | null }> => {
    const { ok, error } = await invokeEdgeFunction('manage-offer', {
      offer_id: parentId,
      action: 'counter',
      amount,
    })
    if (ok) loadOffers()
    return { error: ok ? null : (error ?? 'No se pudo enviar la contraoferta') }
  }

  return { offers, loading, acceptOffer, denyOffer, counterOffer }
}

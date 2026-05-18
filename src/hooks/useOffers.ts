import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Offer } from '../lib/types'

export function useOffers(propertyId: string | null) {
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)

  const loadOffers = useCallback(async () => {
    if (!propertyId) { setLoading(false); return }

    const { data } = await supabase
      .from('offers')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })

    setOffers((data ?? []) as Offer[])
    setLoading(false)
  }, [propertyId])

  useEffect(() => { loadOffers() }, [loadOffers])

  const acceptOffer = async (id: string): Promise<{ error: string | null }> => {
    const { error } = await supabase
      .from('offers')
      .update({ status: 'Accepted', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) loadOffers()
    return { error: error?.message ?? null }
  }

  const denyOffer = async (id: string): Promise<{ error: string | null }> => {
    const { error } = await supabase
      .from('offers')
      .update({ status: 'Denied', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) loadOffers()
    return { error: error?.message ?? null }
  }

  const counterOffer = async (
    parentId: string,
    amount: number,
    propId: string
  ): Promise<{ error: string | null }> => {
    const { error: denyErr } = await supabase
      .from('offers')
      .update({ status: 'Denied', updated_at: new Date().toISOString() })
      .eq('id', parentId)
    if (denyErr) return { error: denyErr.message }

    const { error: insertErr } = await supabase.from('offers').insert({
      salesforce_quote_id: `PWA_${crypto.randomUUID()}`,
      property_id: propId,
      parent_offer_id: parentId,
      initiated_by: 'Owner',
      amount,
      status: 'Presented',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    if (insertErr) return { error: insertErr.message }

    loadOffers()
    return { error: null }
  }

  return { offers, loading, acceptOffer, denyOffer, counterOffer }
}

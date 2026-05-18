import { useState } from 'react'
import { useProperty } from '../hooks/useProperty'
import { useOffers } from '../hooks/useOffers'
import { Modal } from '../components/Modal'
import { Toast, useToast } from '../components/Toast'
import { callEdgeFunction } from '../lib/edgeFunctions'
import type { Offer } from '../lib/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatEuros(amount: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Build linear chains: root → child → grandchild …
function buildChains(offers: Offer[]): Offer[][] {
  const roots = offers.filter((o) => !o.parent_offer_id)
  return roots
    .map((root) => {
      const chain: Offer[] = [root]
      let current = root
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const child = offers.find((o) => o.parent_offer_id === current.id)
        if (!child) break
        chain.push(child)
        current = child
      }
      return chain
    })
    .sort((a, b) => {
      const ta = new Date(a[a.length - 1].created_at ?? 0).getTime()
      const tb = new Date(b[b.length - 1].created_at ?? 0).getTime()
      return tb - ta
    })
}

const STATUS_LABEL: Record<string, string> = {
  Presented: 'Pendiente',
  Accepted: 'Aceptada',
  Denied: 'Rechazada',
}

const STATUS_COLOR: Record<string, string> = {
  Presented: 'bg-yellow-100 text-yellow-700',
  Accepted: 'bg-green-100 text-green-700',
  Denied: 'bg-gray-200 text-gray-500',
}

// ─── Counter-offer modal ─────────────────────────────────────────────────────

function CounterOfferModal({ offer, propertyId, onSubmit, onClose }: {
  offer: Offer
  propertyId: string
  onSubmit: (parentId: string, amount: number, propId: string) => Promise<{ error: string | null }>
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handle = async () => {
    const num = parseInt(amount, 10)
    if (!num || num <= 0) { setErr('Introduce un importe válido mayor que 0'); return }
    setErr(null)
    setSubmitting(true)
    const { error } = await onSubmit(offer.id, num, propertyId)
    if (!error) {
      callEdgeFunction('update-offer-to-sf', { offer_id: offer.id, action: 'counter', counter_amount: num })
    }
    setSubmitting(false)
    if (error) setErr(error)
    else onClose()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[#666666]">
        La oferta actual de <strong>{formatEuros(offer.amount)}</strong> quedará rechazada y se enviará tu contraoferta.
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#666666] uppercase tracking-wide">
          Tu contraoferta (€)
        </label>
        <input
          type="number"
          min={1}
          step={1000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="ej: 240000"
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#2E5EA1]"
          autoFocus
        />
        {err && <p className="text-xs text-[#DC3545]">{err}</p>}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 border border-gray-300 text-[#1A1A1A] font-semibold py-2.5 rounded-xl text-sm"
        >
          Cancelar
        </button>
        <button
          onClick={handle}
          disabled={submitting || !amount}
          className="flex-1 bg-[#2E5EA1] text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
        >
          {submitting ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </div>
  )
}

// ─── Offer chain card ─────────────────────────────────────────────────────────

function OfferChain({ chain, propertyId, onAccept, onDeny, onCounter }: {
  chain: Offer[]
  propertyId: string
  onAccept: (id: string) => Promise<{ error: string | null }>
  onDeny:   (id: string) => Promise<{ error: string | null }>
  onCounter: (parentId: string, amount: number, propId: string) => Promise<{ error: string | null }>
}) {
  const { showToast, toast } = useToast()
  const [actioning, setActioning] = useState(false)
  const [counterTarget, setCounterTarget] = useState<Offer | null>(null)

  const isNegotiation = chain.length > 1
  const latest = chain[chain.length - 1]
  const canAct = latest.status === 'Presented' && latest.initiated_by === 'Buyer'

  const act = async (
    fn: () => Promise<{ error: string | null }>,
    successMsg: string,
    sfFn?: () => Promise<boolean>
  ) => {
    setActioning(true)
    const { error } = await fn()
    setActioning(false)
    if (error) {
      showToast('error', error)
    } else {
      showToast('success', successMsg)
      if (sfFn) {
        const ok = await sfFn()
        if (!ok) showToast('info', 'Los cambios se sincronizarán con Salesforce en breve')
      }
    }
  }

  return (
    <>
      <div className="bg-[#F8F9FA] rounded-2xl overflow-hidden">
        {isNegotiation && (
          <div className="px-4 py-2 bg-[#2E5EA1]/5 border-b border-gray-200">
            <span className="text-xs font-medium text-[#2E5EA1]">Ronda de negociación — {chain.length} ofertas</span>
          </div>
        )}

        {chain.map((offer, idx) => {
          const isLatest = idx === chain.length - 1
          return (
            <div
              key={offer.id}
              className={`px-4 py-3 flex flex-col gap-1 ${idx < chain.length - 1 ? 'border-b border-gray-200 opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-[#666666]">
                    {offer.initiated_by === 'Buyer' ? '🧑 Oferta del comprador' : '🏠 Tu contraoferta'}
                  </p>
                  <p className="text-lg font-bold text-[#1A1A1A]">{formatEuros(offer.amount)}</p>
                  {offer.buyer_name && (
                    <p className="text-xs text-[#666666]">{offer.buyer_name}</p>
                  )}
                  <p className="text-xs text-[#666666]">{formatDate(offer.created_at)}</p>
                </div>
                {isLatest && (
                  <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLOR[offer.status ?? 'presented'] ?? ''}`}>
                    {STATUS_LABEL[offer.status ?? 'presented']}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {canAct && (
          <div className="px-4 pb-4 pt-2 flex flex-col gap-2 border-t border-gray-200">
            <div className="flex gap-2">
              <button
                disabled={actioning}
                onClick={() => act(
                  () => onAccept(latest.id),
                  'Oferta aceptada',
                  () => callEdgeFunction('update-offer-to-sf', { offer_id: latest.id, action: 'accept' })
                )}
                className="flex-1 bg-[#28A745] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
              >
                Aceptar
              </button>
              <button
                disabled={actioning}
                onClick={() => act(
                  () => onDeny(latest.id),
                  'Oferta rechazada',
                  () => callEdgeFunction('update-offer-to-sf', { offer_id: latest.id, action: 'deny' })
                )}
                className="flex-1 border border-[#DC3545] text-[#DC3545] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
              >
                Rechazar
              </button>
            </div>
            <button
              disabled={actioning}
              onClick={() => setCounterTarget(latest)}
              className="w-full border border-[#2E5EA1] text-[#2E5EA1] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
            >
              Contraofertar
            </button>
          </div>
        )}
      </div>

      <Modal
        open={counterTarget !== null}
        onClose={() => setCounterTarget(null)}
        title="Hacer contraoferta"
      >
        {counterTarget && (
          <CounterOfferModal
            offer={counterTarget}
            propertyId={propertyId}
            onSubmit={onCounter}
            onClose={() => setCounterTarget(null)}
          />
        )}
      </Modal>

      <Toast toast={toast} />
    </>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse flex flex-col gap-3 p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-[#F8F9FA] rounded-2xl p-4 flex flex-col gap-2">
          <div className="h-3 w-32 bg-gray-200 rounded" />
          <div className="h-6 w-24 bg-gray-200 rounded" />
          <div className="h-3 w-20 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OffersPage() {
  const { property, loading: propLoading } = useProperty()
  const { offers, loading: offersLoading, acceptOffer, denyOffer, counterOffer } =
    useOffers(property?.id ?? null)

  if (propLoading || offersLoading) return <Skeleton />

  if (!property) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <span className="text-5xl mb-4">🏠</span>
        <p className="text-sm text-[#666666]">Necesitas una vivienda registrada para ver las ofertas.</p>
      </div>
    )
  }

  const chains = buildChains(offers)

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold text-[#1A1A1A]">Mis Ofertas</h1>
        {offers.length > 0 && (
          <p className="text-sm text-[#666666] mt-0.5">{chains.length} negociación{chains.length !== 1 ? 'es' : ''}</p>
        )}
      </div>

      {chains.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-6">
          <span className="text-5xl mb-3">💼</span>
          <p className="text-sm text-[#666666]">Todavía no has recibido ninguna oferta.</p>
        </div>
      ) : (
        <div className="px-4 pb-10 flex flex-col gap-3">
          {chains.map((chain) => (
            <OfferChain
              key={chain[0].id}
              chain={chain}
              propertyId={property.id}
              onAccept={acceptOffer}
              onDeny={denyOffer}
              onCounter={counterOffer}
            />
          ))}
        </div>
      )}
    </div>
  )
}

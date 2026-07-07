import { useState } from 'react'
import { useProperty } from '../hooks/useProperty'
import { useOffers } from '../hooks/useOffers'
import { Modal } from '../components/Modal'
import { Toast, useToast } from '../components/Toast'
import { IconTag, IconHome } from '../components/icons'
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
  Presented: 'bg-violet-light text-violet-dark',
  Accepted: 'bg-teal-light text-teal',
  Denied: 'bg-error-bg text-error',
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
    setSubmitting(false)
    if (error) setErr(error)
    else onClose()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate">
        La oferta actual de <strong className="text-ink">{formatEuros(offer.amount)}</strong> quedará rechazada y se enviará tu contraoferta.
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold text-slate-light tracking-[0.02em]">
          Tu contraoferta (€)
        </label>
        <input
          type="number"
          min={1}
          step={1000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="ej: 240000"
          className="w-full rounded-[7px] border border-line px-3.5 py-2.5 text-base text-ink placeholder-slate-light focus:outline-none focus:border-violet focus:ring-[3px] focus:ring-violet/12"
          autoFocus
        />
        {err && <p className="text-xs text-error">{err}</p>}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 border border-line text-ink font-medium py-2.5 rounded-[7px] text-[13px] hover:bg-surface transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handle}
          disabled={submitting || !amount}
          className="flex-1 bg-violet hover:bg-violet-dark text-white font-medium py-2.5 rounded-[7px] text-[13px] disabled:opacity-50 transition-colors"
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
  ) => {
    setActioning(true)
    const { error } = await fn()
    setActioning(false)
    if (error) {
      showToast('error', error)
    } else {
      showToast('success', successMsg)
    }
  }

  return (
    <>
      <div className="bg-white border border-line rounded-xl overflow-hidden">
        {isNegotiation && (
          <div className="px-4 py-2 bg-violet-light border-b border-violet-light">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-violet-dark">
              Ronda de negociación · {chain.length} ofertas
            </span>
          </div>
        )}

        {chain.map((offer, idx) => {
          const isLatest = idx === chain.length - 1
          return (
            <div
              key={offer.id}
              className={`px-4 py-3 flex flex-col gap-1 ${idx < chain.length - 1 ? 'border-b border-line-subtle opacity-50' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-light">
                    {offer.initiated_by === 'Buyer' ? 'Oferta del comprador' : 'Tu contraoferta'}
                  </p>
                  <p className="text-xl font-bold tracking-[-0.03em] text-ink">{formatEuros(offer.amount)}</p>
                  <p className="text-xs text-slate-light mt-0.5">
                    {[offer.buyer_name, formatDate(offer.created_at)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {isLatest && (
                  <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${STATUS_COLOR[offer.status ?? 'Presented'] ?? ''}`}>
                    {STATUS_LABEL[offer.status ?? 'Presented']}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {canAct && (
          <div className="px-4 pb-4 pt-3 flex flex-col gap-2 border-t border-line-subtle">
            <div className="flex gap-2">
              <button
                disabled={actioning}
                onClick={() => act(() => onAccept(latest.id), 'Oferta aceptada')}
                className="flex-1 bg-violet hover:bg-violet-dark text-white text-[13px] font-medium py-2.5 rounded-[7px] disabled:opacity-50 active:scale-[0.98] transition"
              >
                Aceptar
              </button>
              <button
                disabled={actioning}
                onClick={() => act(() => onDeny(latest.id), 'Oferta rechazada')}
                className="flex-1 border border-line text-error text-[13px] font-medium py-2.5 rounded-[7px] disabled:opacity-50 active:scale-[0.98] transition"
              >
                Rechazar
              </button>
            </div>
            <button
              disabled={actioning}
              onClick={() => setCounterTarget(latest)}
              className="w-full border border-line text-ink text-[13px] font-medium py-2.5 rounded-[7px] hover:bg-surface disabled:opacity-50 active:scale-[0.98] transition"
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
        <div key={i} className="bg-white border border-line rounded-xl p-4 flex flex-col gap-2">
          <div className="h-3 w-32 bg-line-subtle rounded" />
          <div className="h-6 w-24 bg-line-subtle rounded" />
          <div className="h-3 w-20 bg-line-subtle rounded" />
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
        <span className="w-12 h-12 rounded-full bg-violet-light text-violet-dark flex items-center justify-center mb-4">
          <IconHome size={22} />
        </span>
        <p className="text-sm text-slate">Necesitas una vivienda registrada para ver las ofertas.</p>
      </div>
    )
  }

  const chains = buildChains(offers)

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet">Mis ofertas</p>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ink mt-0.5">
          {chains.length === 0
            ? 'Ofertas'
            : `${chains.length} negociación${chains.length !== 1 ? 'es' : ''}`}
        </h1>
      </div>

      {chains.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-6">
          <span className="w-12 h-12 rounded-full bg-violet-light text-violet-dark flex items-center justify-center mb-3">
            <IconTag size={22} />
          </span>
          <p className="text-sm text-slate">Todavía no has recibido ninguna oferta.</p>
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

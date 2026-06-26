import { useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { useProperty } from '../hooks/useProperty'
import { Toggle } from '../components/Toggle'
import { Toast, useToast } from '../components/Toast'
import type { Property } from '../lib/types'

// ─── Draft type (all inputs as strings for native inputs) ────────────────────

type Draft = {
  street: string; city: string; state: string; postal_code: string
  housing_type: string; rooms: string; bathrooms: string
  built_area: string; useful_surface_area: string
  age: string; floor: string
  has_elevator: boolean | null; is_exterior: boolean | null
  orientation: string; heating_type: string; condition: string
  community_fee: string; electronic_certificate: string
  sales_price: string; reject_offers_below: string
  ref_catastral: string; description: string
  garage_space: string; registro_propiedad: string
}

function toDraft(p: Property): Draft {
  const s = (v: string | null) => v ?? ''
  const n = (v: number | null) => v != null ? String(v) : ''
  return {
    street: s(p.street), city: s(p.city), state: s(p.state), postal_code: s(p.postal_code),
    housing_type: s(p.housing_type), rooms: n(p.rooms), bathrooms: n(p.bathrooms),
    built_area: n(p.built_area), useful_surface_area: n(p.useful_surface_area),
    age: n(p.age), floor: n(p.floor),
    has_elevator: p.has_elevator, is_exterior: p.is_exterior,
    orientation: s(p.orientation), heating_type: s(p.heating_type), condition: s(p.condition),
    community_fee: n(p.community_fee), electronic_certificate: s(p.electronic_certificate),
    sales_price: n(p.sales_price), reject_offers_below: n(p.reject_offers_below),
    ref_catastral: s(p.ref_catastral), description: s(p.description),
    garage_space: s(p.garage_space), registro_propiedad: n(p.registro_propiedad),
  }
}

function toUpdates(d: Draft): Partial<Property> {
  const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? null : n }
  const int = (s: string) => { const n = parseInt(s, 10); return isNaN(n) ? null : n }
  const str = (s: string) => s || null
  return {
    street: str(d.street), city: str(d.city), state: str(d.state), postal_code: str(d.postal_code),
    housing_type: str(d.housing_type) as Property['housing_type'],
    rooms: int(d.rooms), bathrooms: int(d.bathrooms),
    built_area: num(d.built_area), useful_surface_area: num(d.useful_surface_area),
    age: int(d.age), floor: int(d.floor),
    has_elevator: d.has_elevator, is_exterior: d.is_exterior,
    orientation: str(d.orientation) as Property['orientation'],
    heating_type: str(d.heating_type) as Property['heating_type'],
    condition: str(d.condition) as Property['condition'],
    community_fee: num(d.community_fee),
    electronic_certificate: str(d.electronic_certificate) as Property['electronic_certificate'],
    sales_price: num(d.sales_price), reject_offers_below: num(d.reject_offers_below),
    ref_catastral: str(d.ref_catastral), description: str(d.description),
    garage_space: str(d.garage_space) as Property['garage_space'],
    registro_propiedad: num(d.registro_propiedad),
  }
}

function validate(d: Draft): string[] {
  const errors: string[] = []
  const price = parseFloat(d.sales_price)
  const minOffer = parseFloat(d.reject_offers_below)
  const rooms = parseInt(d.rooms, 10)
  const baths = parseInt(d.bathrooms, 10)
  if (d.sales_price && !isNaN(price) && price <= 0)
    errors.push('El precio de venta debe ser mayor que 0')
  if (d.sales_price && d.reject_offers_below && !isNaN(price) && !isNaN(minOffer) && minOffer >= price)
    errors.push('La oferta mínima debe ser menor que el precio de venta')
  if (d.rooms && !isNaN(rooms) && (rooms < 1 || rooms > 8))
    errors.push('Las habitaciones deben estar entre 1 y 8')
  if (d.bathrooms && !isNaN(baths) && (baths < 1 || baths > 5))
    errors.push('Los baños deben estar entre 1 y 5')
  return errors
}

// ─── Shared input styles ─────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#1A1A1A] bg-white focus:outline-none focus:ring-2 focus:ring-[#2E5EA1] focus:border-transparent'

// ─── Sub-components ──────────────────────────────────────────────────────────

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#F8F9FA] rounded-2xl p-5">
      <h2 className="text-base font-semibold text-[#1A1A1A] mb-4">{title}</h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        {children}
      </div>
    </div>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}>
      <label className="text-xs font-medium text-[#666666] uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function SelectField({ value, onChange, options, placeholder }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">{placeholder ?? '— Sin especificar —'}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// Valor de solo lectura (honorarios: vienen de Salesforce o los calcula la BD)
const readOnlyCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#666666] bg-gray-50'

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return <div className={readOnlyCls}>{children}</div>
}

const eur = (v: number | null) =>
  v != null ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v) : '—'
const pct = (v: number | null) =>
  v != null ? `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)}%` : '—'

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[#666666] uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-2 pt-1">
        <Toggle checked={checked} onChange={onChange} />
        <span className="text-sm text-[#1A1A1A]">{checked ? 'Sí' : 'No'}</span>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4 p-6 animate-pulse">
      <div className="h-7 w-40 bg-gray-200 rounded-lg" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-[#F8F9FA] rounded-2xl p-5">
          <div className="h-4 w-28 bg-gray-200 rounded mb-4" />
          <div className="grid grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="flex flex-col gap-1">
                <div className="h-3 w-20 bg-gray-200 rounded" />
                <div className="h-8 bg-gray-200 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Form ────────────────────────────────────────────────────────────────────

function PropertyForm({ property, saveProperty }: {
  property: Property
  saveProperty: (updates: Partial<Property>) => Promise<{ error: string | null }>
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(property))
  const initialDraft = useRef(draft)
  const [saving, setSaving] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const { showToast, toast } = useToast()

  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft.current)

  const blocker = useBlocker(isDirty)
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Tienes cambios sin guardar. ¿Quieres salir de todas formas?')) {
        blocker.proceed()
      } else {
        blocker.reset()
      }
    }
  }, [blocker])

  const set = (key: keyof Draft, value: Draft[keyof Draft]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const handleSave = async () => {
    const errors = validate(draft)
    if (errors.length > 0) { setValidationErrors(errors); return }
    setValidationErrors([])
    setSaving(true)
    const updates = toUpdates(draft)
    const { error } = await saveProperty(updates)
    setSaving(false)
    if (error) {
      showToast('error', 'No se pudo guardar. Inténtalo de nuevo.')
    } else {
      initialDraft.current = draft
      showToast('success', 'Cambios guardados correctamente')
    }
  }

  return (
    <div className="p-6 flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      <h1 className="text-xl font-bold text-[#1A1A1A]">Mi Vivienda</h1>

      {/* Ubicación */}
      <FormSection title="Ubicación">
        <Field label="Calle" full>
          <input className={inputCls} value={draft.street} onChange={(e) => set('street', e.target.value)} placeholder="Calle Mayor, 1" />
        </Field>
        <Field label="Ciudad">
          <input className={inputCls} value={draft.city} onChange={(e) => set('city', e.target.value)} placeholder="Madrid" />
        </Field>
        <Field label="Provincia">
          <input className={inputCls} value={draft.state} onChange={(e) => set('state', e.target.value)} placeholder="Madrid" />
        </Field>
        <Field label="Código postal">
          <input className={inputCls} value={draft.postal_code} onChange={(e) => set('postal_code', e.target.value)} placeholder="28001" />
        </Field>
      </FormSection>

      {/* Características */}
      <FormSection title="Características">
        <Field label="Tipo de vivienda">
          <SelectField value={draft.housing_type} onChange={(v) => set('housing_type', v)}
            options={['Piso', 'Chalet', 'Ático', 'Dúplex', 'Estudio', 'Finca rústica']} />
        </Field>
        <Field label="Habitaciones">
          <input type="number" min={1} max={8} className={inputCls} value={draft.rooms} onChange={(e) => set('rooms', e.target.value)} placeholder="3" />
        </Field>
        <Field label="Baños">
          <input type="number" min={1} max={5} className={inputCls} value={draft.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} placeholder="2" />
        </Field>
        <Field label="Planta">
          <input type="number" min={0} className={inputCls} value={draft.floor} onChange={(e) => set('floor', e.target.value)} placeholder="3" />
        </Field>
        <Field label="Superficie construida (m²)">
          <input type="number" min={0} className={inputCls} value={draft.built_area} onChange={(e) => set('built_area', e.target.value)} placeholder="120" />
        </Field>
        <Field label="Superficie útil (m²)">
          <input type="number" min={0} className={inputCls} value={draft.useful_surface_area} onChange={(e) => set('useful_surface_area', e.target.value)} placeholder="100" />
        </Field>
        <Field label="Antigüedad (años)">
          <input type="number" min={0} className={inputCls} value={draft.age} onChange={(e) => set('age', e.target.value)} placeholder="20" />
        </Field>
        <Field label="Orientación">
          <SelectField value={draft.orientation} onChange={(v) => set('orientation', v)}
            options={['Norte', 'Sur', 'Este', 'Oeste', 'Sureste', 'Suroeste', 'Noreste', 'Noroeste']} />
        </Field>
        <Field label="Calefacción">
          <SelectField value={draft.heating_type} onChange={(v) => set('heating_type', v)}
            options={['No disponible', 'Central', 'Individual - Eléctrica', 'Individual Gas', 'Individual Otros']} />
        </Field>
        <Field label="Estado del inmueble">
          <SelectField value={draft.condition} onChange={(v) => set('condition', v)}
            options={['Nueva o recién reformada', 'Buen estado', 'Para reformar']} />
        </Field>
        <Field label="Plaza de garaje">
          <SelectField value={draft.garage_space} onChange={(v) => set('garage_space', v)}
            options={['Sin plaza de garaje', 'Con 1 plaza de garaje', 'Con 2 plazas de garaje', 'Con 3 plazas de garaje']} />
        </Field>
        <ToggleField label="Ascensor" checked={draft.has_elevator} onChange={(v) => set('has_elevator', v)} />
        <ToggleField label="Exterior" checked={draft.is_exterior} onChange={(v) => set('is_exterior', v)} />
      </FormSection>

      {/* Precios */}
      <FormSection title="Precios">
        <Field label="Precio de venta (€)">
          <input type="number" min={0} className={inputCls} value={draft.sales_price} onChange={(e) => set('sales_price', e.target.value)} placeholder="250000" />
        </Field>
        <Field label="Oferta mínima (€)">
          <input type="number" min={0} className={inputCls} value={draft.reject_offers_below} onChange={(e) => set('reject_offers_below', e.target.value)} placeholder="220000" />
        </Field>
        <Field label="Gastos de comunidad (€/mes)">
          <input type="number" min={0} className={inputCls} value={draft.community_fee} onChange={(e) => set('community_fee', e.target.value)} placeholder="150" />
        </Field>
        <Field label="Honorarios Herohome (%)">
          <ReadOnlyValue>{pct(property.owner_fee_percent)}</ReadOnlyValue>
        </Field>
        <Field label="Honorarios Herohome (€)">
          <ReadOnlyValue>{eur(property.owner_fee)}</ReadOnlyValue>
        </Field>
      </FormSection>

      {/* Otros */}
      <FormSection title="Otros datos">
        <Field label="Certificado energético">
          <SelectField value={draft.electronic_certificate} onChange={(v) => set('electronic_certificate', v)}
            options={['A', 'B', 'C', 'D', 'E', 'F', 'G', 'En trámite']} />
        </Field>
        <Field label="Ref. catastral">
          <input className={inputCls} value={draft.ref_catastral} onChange={(e) => set('ref_catastral', e.target.value)} placeholder="0000000AA0000A0000AA" />
        </Field>
        <Field label="Registro de la propiedad (nº)">
          <input type="number" className={inputCls} value={draft.registro_propiedad} onChange={(e) => set('registro_propiedad', e.target.value)} />
        </Field>
      </FormSection>

      {/* Descripción */}
      <div className="bg-[#F8F9FA] rounded-2xl p-5">
        <h2 className="text-base font-semibold text-[#1A1A1A] mb-4">Descripción</h2>
        <textarea
          rows={5}
          className={`${inputCls} resize-none`}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Describe tu vivienda..."
        />
      </div>

      {/* Errores de validación */}
      {validationErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col gap-1">
          {validationErrors.map((e) => (
            <p key={e} className="text-sm text-[#DC3545]">• {e}</p>
          ))}
        </div>
      )}

      {/* Botón guardar (sticky en móvil) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-4 z-20">
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="w-full max-w-2xl mx-auto block bg-[#2E5EA1] text-white font-semibold py-3 rounded-xl text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>

      <Toast toast={toast} />
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PropertyPage() {
  const { property, loading, error, saveProperty } = useProperty()

  if (loading) return <Skeleton />

  if (error === 'no_property' || !property) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <span className="text-5xl mb-4">🏠</span>
        <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">No hay vivienda registrada</h2>
        <p className="text-sm text-[#666666]">Todavía no tienes ninguna vivienda asociada a tu cuenta. Contacta con tu agente Herohome.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <span className="text-5xl mb-4">⚠️</span>
        <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">Error al cargar la vivienda</h2>
        <p className="text-sm text-[#666666]">{error}</p>
      </div>
    )
  }

  return <PropertyForm property={property} saveProperty={saveProperty} />
}

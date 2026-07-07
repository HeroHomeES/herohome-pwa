import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useProperty } from '../hooks/useProperty'
import { useVisits } from '../hooks/useVisits'
import { useAvailability } from '../hooks/useAvailability'
import { Toggle } from '../components/Toggle'
import { Toast, useToast } from '../components/Toast'
import { IconUser, IconPhone, IconCalendar, IconInbox, IconHome } from '../components/icons'
import type { AvailabilityDay, VisitSlot } from '../lib/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const FROM_HOURS = Array.from({ length: 15 }, (_, i) => i + 7)   // 7..21
const TO_HOURS   = Array.from({ length: 15 }, (_, i) => i + 8)   // 8..22

function hourLabel(h: number) {
  return `${h.toString().padStart(2, '0')}:00`
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
function visitorName(v: VisitSlot) {
  const parts = [v.visitor_name, v.visitor_last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Visitante sin nombre'
}

// ─── Shared skeleton ─────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="animate-pulse flex flex-col gap-3 p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white border border-line rounded-xl p-4 flex flex-col gap-2">
          <div className="h-3 w-32 bg-line-subtle rounded" />
          <div className="h-4 w-24 bg-line-subtle rounded" />
          <div className="h-3 w-40 bg-line-subtle rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <span className="w-12 h-12 rounded-full bg-violet-light text-violet-dark flex items-center justify-center mb-3">
        {icon}
      </span>
      <p className="text-sm text-slate">{text}</p>
    </div>
  )
}

// ─── Segmented control ───────────────────────────────────────────────────────

type Tab = 'pending' | 'upcoming' | 'availability'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pending',      label: 'Pendientes' },
  { id: 'upcoming',     label: 'Próximas' },
  { id: 'availability', label: 'Disponibilidad' },
]

function TabBar({ active, onChange, pendingCount }: {
  active: Tab
  onChange: (t: Tab) => void
  pendingCount: number
}) {
  return (
    <div className="flex bg-line-subtle rounded-[9px] p-[3px] gap-0.5 mx-4">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 flex items-center justify-center gap-1.5 px-1 py-1.5 text-xs rounded-[7px] whitespace-nowrap transition-colors ${
            active === id
              ? 'bg-white border border-line font-semibold text-ink'
              : 'font-medium text-slate'
          }`}
        >
          {label}
          {id === 'pending' && pendingCount > 0 && (
            <span className="bg-violet text-white text-[10px] font-bold rounded-full px-1.5 py-px">
              {pendingCount}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── Visit card pieces ───────────────────────────────────────────────────────

function VisitInfo({ visit }: { visit: VisitSlot }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-light">
        {formatDate(visit.start_time)}
      </p>
      <p className="text-lg font-semibold tracking-[-0.02em] text-ink mt-0.5">
        {formatTime(visit.start_time)} – {formatTime(visit.end_time)}
      </p>
      <p className="flex items-center gap-1.5 text-sm text-slate mt-2">
        <IconUser size={15} className="text-slate-light shrink-0" />
        {visitorName(visit)}
      </p>
      {visit.visitor_phone && (
        <p className="flex items-center gap-1.5 text-sm text-slate mt-1">
          <IconPhone size={15} className="text-slate-light shrink-0" />
          {visit.visitor_phone}
        </p>
      )}
    </div>
  )
}

// ─── Pending tab ─────────────────────────────────────────────────────────────

function PendingTab({ visits, onConfirm, onCancel }: {
  visits: VisitSlot[]
  onConfirm: (id: string) => Promise<{ error: string | null }>
  onCancel:  (id: string) => Promise<{ error: string | null }>
}) {
  const { showToast, toast } = useToast()
  const [actioningId, setActioningId] = useState<string | null>(null)

  const act = async (fn: () => Promise<{ error: string | null }>, id: string) => {
    setActioningId(id)
    const { error } = await fn()
    setActioningId(null)
    if (error) showToast('error', error)
    else showToast('success', 'Visita actualizada correctamente')
  }

  if (visits.length === 0) {
    return <EmptyState icon={<IconInbox size={22} />} text="No hay visitas pendientes de confirmación" />
  }

  return (
    <div className="p-4 flex flex-col gap-3 pb-10">
      {visits.map((visit) => (
        <div key={visit.id} className="bg-white border border-line rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <VisitInfo visit={visit} />
            <span className="shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-surface text-slate border border-line">
              Pendiente
            </span>
          </div>
          <div className="flex gap-2">
            <button
              disabled={actioningId === visit.id}
              onClick={() => act(() => onConfirm(visit.id), visit.id)}
              className="flex-1 bg-violet hover:bg-violet-dark text-white text-[13px] font-medium py-2.5 rounded-[7px] disabled:opacity-50 active:scale-[0.98] transition"
            >
              Confirmar
            </button>
            <button
              disabled={actioningId === visit.id}
              onClick={() => act(() => onCancel(visit.id), visit.id)}
              className="flex-1 bg-transparent border border-line text-error text-[13px] font-medium py-2.5 rounded-[7px] disabled:opacity-50 active:scale-[0.98] transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      ))}
      <Toast toast={toast} />
    </div>
  )
}

// ─── Upcoming tab ─────────────────────────────────────────────────────────────

function UpcomingTab({ visits, onReschedule }: {
  visits: VisitSlot[]
  onReschedule: (visit: VisitSlot) => Promise<{ error: string | null }>
}) {
  const { showToast, toast } = useToast()
  const [actioningId, setActioningId] = useState<string | null>(null)

  const act = async (visit: VisitSlot) => {
    setActioningId(visit.id)
    const { error } = await onReschedule(visit)
    setActioningId(null)
    if (error) showToast('error', error)
    else showToast('success', 'Visita cancelada. El comprador será notificado.')
  }

  if (visits.length === 0) {
    return <EmptyState icon={<IconCalendar size={22} />} text="No tienes próximas visitas confirmadas" />
  }

  return (
    <div className="p-4 flex flex-col gap-3 pb-10">
      {visits.map((visit) => (
        <div key={visit.id} className="bg-white border border-line rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <VisitInfo visit={visit} />
            <span className="shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-teal-light text-teal">
              Confirmada
            </span>
          </div>
          <button
            disabled={actioningId === visit.id}
            onClick={() => act(visit)}
            className="w-full bg-transparent border border-line text-ink text-[13px] font-medium py-2.5 rounded-[7px] hover:bg-surface disabled:opacity-50 active:scale-[0.98] transition"
          >
            Solicitar reagendar
          </button>
        </div>
      ))}
      <Toast toast={toast} />
    </div>
  )
}

// ─── Availability tab ─────────────────────────────────────────────────────────

function AvailabilityTab({ propertyId }: { propertyId: string }) {
  const { config, setConfig, loading, saveConfig } = useAvailability(propertyId)
  const { showToast, toast } = useToast()
  const [saving, setSaving] = useState(false)

  if (loading) return <CardSkeleton />

  const updateDay = (index: number, patch: Partial<AvailabilityDay>) => {
    setConfig((prev) => prev.map((d, i) => i === index ? { ...d, ...patch } : d))
  }

  const handleSave = async () => {
    setSaving(true)
    const { error } = await saveConfig()
    setSaving(false)
    if (error) showToast('error', 'No se pudo guardar. Inténtalo de nuevo.')
    else showToast('success', 'Disponibilidad guardada correctamente')
  }

  return (
    <div className="p-4 flex flex-col gap-4 pb-10">
      <p className="text-sm text-slate">
        Configura los días y horas en que los compradores pueden solicitar visitas.
      </p>

      <div className="bg-white border border-line rounded-xl overflow-hidden">
        {config.map((day, i) => (
          <div
            key={day.day_of_week}
            className={`flex items-center gap-2 px-4 py-3 ${i < config.length - 1 ? 'border-b border-line-subtle' : ''}`}
          >
            <span className={`text-sm font-medium w-16 shrink-0 ${!day.is_active ? 'text-slate-light' : 'text-ink'}`}>
              {DAY_NAMES[day.day_of_week]}
            </span>
            <Toggle
              checked={day.is_active}
              onChange={(v) => updateDay(i, { is_active: v })}
            />
            <select
              disabled={!day.is_active}
              value={day.from_hour}
              onChange={(e) => {
                const from = parseInt(e.target.value, 10)
                updateDay(i, { from_hour: from, to_hour: Math.max(day.to_hour, from + 1) })
              }}
              className="text-[13px] border border-line rounded-[7px] px-2 py-1 bg-white text-ink focus:outline-none focus:border-violet focus:ring-[3px] focus:ring-violet/12 disabled:opacity-40"
            >
              {FROM_HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span className="text-xs text-slate-light">–</span>
            <select
              disabled={!day.is_active}
              value={day.to_hour}
              onChange={(e) => updateDay(i, { to_hour: parseInt(e.target.value, 10) })}
              className="text-[13px] border border-line rounded-[7px] px-2 py-1 bg-white text-ink focus:outline-none focus:border-violet focus:ring-[3px] focus:ring-violet/12 disabled:opacity-40"
            >
              {TO_HOURS.filter((h) => h > day.from_hour).map((h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-violet hover:bg-violet-dark text-white font-medium py-3 rounded-[7px] text-[13px] disabled:opacity-50 active:scale-[0.98] transition"
      >
        {saving ? 'Guardando...' : 'Guardar disponibilidad'}
      </button>

      <Toast toast={toast} />
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { property, loading: propLoading } = useProperty()
  const [searchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as Tab
  const validTabs: Tab[] = ['pending', 'upcoming', 'availability']
  const [activeTab, setActiveTab] = useState<Tab>(
    validTabs.includes(tabParam) ? tabParam : 'pending'
  )

  const { pending, upcoming, loading: visitsLoading, confirmVisit, cancelVisit, requestReschedule } =
    useVisits(property?.id ?? null)

  if (propLoading) return <CardSkeleton />

  if (!property) {
    return (
      <div className="p-6">
        <EmptyState icon={<IconHome size={22} />} text="Necesitas una vivienda registrada para ver el calendario." />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet">Mi calendario</p>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ink mt-0.5">Visitas</h1>
      </div>

      <TabBar
        active={activeTab}
        onChange={setActiveTab}
        pendingCount={pending.length}
      />

      {visitsLoading && activeTab !== 'availability' ? (
        <CardSkeleton />
      ) : activeTab === 'pending' ? (
        <PendingTab visits={pending} onConfirm={confirmVisit} onCancel={cancelVisit} />
      ) : activeTab === 'upcoming' ? (
        <UpcomingTab visits={upcoming} onReschedule={requestReschedule} />
      ) : (
        <AvailabilityTab propertyId={property.id} />
      )}
    </div>
  )
}

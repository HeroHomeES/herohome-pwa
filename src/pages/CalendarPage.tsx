import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useProperty } from '../hooks/useProperty'
import { useVisits } from '../hooks/useVisits'
import { useAvailability } from '../hooks/useAvailability'
import { Toggle } from '../components/Toggle'
import { Toast, useToast } from '../components/Toast'
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
        <div key={i} className="bg-[#F8F9FA] rounded-2xl p-4 flex flex-col gap-2">
          <div className="h-3 w-32 bg-gray-200 rounded" />
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-3 w-40 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <span className="text-4xl mb-3">{icon}</span>
      <p className="text-sm text-[#666666]">{text}</p>
    </div>
  )
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

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
    <div className="flex border-b border-gray-200 px-2">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`relative px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
            active === id ? 'text-[#2E5EA1]' : 'text-[#666666]'
          }`}
        >
          {label}
          {id === 'pending' && pendingCount > 0 && (
            <span className="ml-1.5 bg-[#2E5EA1] text-white text-xs font-bold rounded-full px-1.5 py-0.5">
              {pendingCount}
            </span>
          )}
          {active === id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2E5EA1] rounded-t" />
          )}
        </button>
      ))}
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
    return <EmptyState icon="📭" text="No hay visitas pendientes de confirmación" />
  }

  return (
    <div className="p-4 flex flex-col gap-3 pb-10">
      {visits.map((visit) => (
        <div key={visit.id} className="bg-[#F8F9FA] rounded-2xl p-4 flex flex-col gap-3">
          <div>
            <p className="text-xs text-[#666666] capitalize">{formatDate(visit.start_time)}</p>
            <p className="text-base font-semibold text-[#1A1A1A]">
              {formatTime(visit.start_time)} – {formatTime(visit.end_time)}
            </p>
            <p className="text-sm text-[#1A1A1A] mt-0.5">👤 {visitorName(visit)}</p>
            {visit.visitor_phone && (
              <p className="text-sm text-[#666666]">📞 {visit.visitor_phone}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              disabled={actioningId === visit.id}
              onClick={() => act(() => onConfirm(visit.id), visit.id)}
              className="flex-1 bg-[#28A745] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
            >
              Confirmar
            </button>
            <button
              disabled={actioningId === visit.id}
              onClick={() => act(() => onCancel(visit.id), visit.id)}
              className="flex-1 bg-white border border-[#DC3545] text-[#DC3545] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
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
    return <EmptyState icon="📅" text="No tienes próximas visitas confirmadas" />
  }

  return (
    <div className="p-4 flex flex-col gap-3 pb-10">
      {visits.map((visit) => (
        <div key={visit.id} className="bg-[#F8F9FA] rounded-2xl p-4 flex flex-col gap-3">
          <div>
            <p className="text-xs text-[#666666] capitalize">{formatDate(visit.start_time)}</p>
            <p className="text-base font-semibold text-[#1A1A1A]">
              {formatTime(visit.start_time)} – {formatTime(visit.end_time)}
            </p>
            <p className="text-sm text-[#1A1A1A] mt-0.5">👤 {visitorName(visit)}</p>
            {visit.visitor_phone && (
              <p className="text-sm text-[#666666]">📞 {visit.visitor_phone}</p>
            )}
          </div>
          <button
            disabled={actioningId === visit.id}
            onClick={() => act(visit)}
            className="w-full bg-white border border-gray-300 text-[#1A1A1A] text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
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
      <p className="text-sm text-[#666666]">
        Configura los días y horas en que los compradores pueden solicitar visitas.
      </p>

      <div className="bg-[#F8F9FA] rounded-2xl overflow-hidden">
        {config.map((day, i) => (
          <div
            key={day.day_of_week}
            className={`flex items-center gap-2 px-4 py-3 ${i < config.length - 1 ? 'border-b border-gray-200' : ''}`}
          >
            <span className={`text-sm font-medium w-16 shrink-0 ${!day.is_active ? 'text-[#666666]' : 'text-[#1A1A1A]'}`}>
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
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#2E5EA1] disabled:opacity-40"
            >
              {FROM_HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span className="text-xs text-[#666666]">–</span>
            <select
              disabled={!day.is_active}
              value={day.to_hour}
              onChange={(e) => updateDay(i, { to_hour: parseInt(e.target.value, 10) })}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[#2E5EA1] disabled:opacity-40"
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
        className="w-full bg-[#2E5EA1] text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50 active:scale-95 transition-transform"
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
        <EmptyState icon="🏠" text="Necesitas una vivienda registrada para ver el calendario." />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 pb-1">
        <h1 className="text-xl font-bold text-[#1A1A1A]">Mi Calendario</h1>
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

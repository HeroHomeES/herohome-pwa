import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useNotifications } from '../hooks/useNotifications'
import { HerohomeLogo } from '../components/HerohomeLogo'
import {
  IconMessageCircle, IconHome, IconCalendar, IconTag, IconUsers, IconBell,
  IconCheckCircle, IconXCircle, IconEuro, IconRefresh,
} from '../components/icons'
import type { AppNotification } from '../lib/types'

// ─── Notification config ──────────────────────────────────────────────────────

const NOTIF_ICON: Record<string, React.ReactNode> = {
  new_visit_request: <IconCalendar size={18} />,
  visit_confirmed:   <IconCheckCircle size={18} />,
  visit_canceled:    <IconXCircle size={18} />,
  new_offer:         <IconEuro size={18} />,
  offer_updated:     <IconRefresh size={18} />,
}

const NOTIF_TINT: Record<string, string> = {
  new_visit_request: 'bg-violet-light text-violet-dark',
  visit_confirmed:   'bg-teal-light text-teal',
  visit_canceled:    'bg-error-bg text-error',
  new_offer:         'bg-violet-light text-violet-dark',
  offer_updated:     'bg-violet-light text-violet-dark',
}

const NOTIF_LABEL: Record<string, string> = {
  new_visit_request: 'Nueva solicitud de visita',
  visit_confirmed:   'Visita confirmada',
  visit_canceled:    'Visita cancelada',
  new_offer:         'Nueva oferta recibida',
  offer_updated:     'Oferta actualizada',
}

const NOTIF_ROUTE: Record<string, string> = {
  new_visit_request: '/calendar?tab=pending',
  visit_confirmed:   '/calendar?tab=upcoming',
  visit_canceled:    '/calendar?tab=upcoming',
  new_offer:         '/offers',
  offer_updated:     '/offers',
}

function timeAgo(iso: string | null) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

// ─── Tab bar (4 secciones — DESIGN.md v3) ─────────────────────────────────────

const tabItems = [
  { to: '/',         label: 'Hero',     icon: IconMessageCircle, end: true  },
  { to: '/property', label: 'Vivienda', icon: IconHome,          end: false },
  { to: '/calendar', label: 'Visitas',  icon: IconCalendar,      end: false },
  { to: '/offers',   label: 'Ofertas',  icon: IconTag,           end: false },
]

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function MainLayout() {
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()

  const handleNotifClick = async (notif: AppNotification) => {
    await markAsRead(notif.id)
    setNotifOpen(false)
    navigate(NOTIF_ROUTE[notif.type] ?? '/')
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header — 52px, fondo oscuro (DESIGN.md: navbar #111827) */}
      <header className="fixed top-0 left-0 right-0 z-30 bg-navbar flex items-center justify-between px-4 h-[52px]">
        <NavLink to="/" aria-label="Inicio">
          <HerohomeLogo size={22} dark />
        </NavLink>

        <div className="flex items-center gap-1">
          <NavLink
            to="/team"
            aria-label="Mi Equipo"
            className={({ isActive }) =>
              `p-2 rounded-lg transition-colors ${isActive ? 'text-violet' : 'text-white/70 hover:text-white'}`
            }
          >
            <IconUsers size={20} />
          </NavLink>

          <button
            onClick={() => setNotifOpen((o) => !o)}
            className="relative p-2 rounded-lg text-white/70 hover:text-white transition-colors"
            aria-label="Notificaciones"
          >
            <IconBell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 bg-violet text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 border-2 border-navbar box-content">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Notification overlay */}
      {notifOpen && (
        <div className="fixed inset-0 z-[35] bg-black/20" onClick={() => setNotifOpen(false)} />
      )}

      {/* Notification panel */}
      {notifOpen && (
        <div className="fixed top-[52px] right-0 left-0 sm:left-auto sm:w-80 z-[36] bg-white border-b border-line sm:border sm:rounded-b-xl sm:mr-2 max-h-[70vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line-subtle">
            <span className="text-sm font-semibold text-ink">Notificaciones</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-violet font-medium"
              >
                Marcar todo como leído
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-slate">No tienes notificaciones nuevas</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleNotifClick(notif)}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface transition-colors border-b border-line-subtle text-left"
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${NOTIF_TINT[notif.type] ?? 'bg-violet-light text-violet-dark'}`}>
                    {NOTIF_ICON[notif.type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink leading-tight">
                      {NOTIF_LABEL[notif.type]}
                    </p>
                    <p className="text-xs text-slate-light mt-0.5">{timeAgo(notif.created_at)}</p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-violet shrink-0 mt-1.5" />
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <main className="flex-1 pt-[52px] pb-[calc(60px+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>

      {/* Bottom tab bar — 60px + safe area (iPhone standalone) */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="h-[60px] flex justify-around items-center">
          {tabItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 w-[68px] text-[10px] font-medium transition-colors ${
                  isActive ? 'text-violet' : 'text-slate-light'
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

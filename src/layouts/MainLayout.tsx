import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotifications } from '../hooks/useNotifications'
import type { AppNotification } from '../lib/types'

// ─── Notification config ──────────────────────────────────────────────────────

const NOTIF_ICON: Record<string, string> = {
  new_visit_request: '📅',
  visit_confirmed:   '✅',
  visit_canceled:    '❌',
  new_offer:         '💰',
  offer_updated:     '🔄',
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

// ─── Nav items ────────────────────────────────────────────────────────────────

const navItems = [
  { to: '/',          label: 'Inicio',        icon: '🏠', end: true  },
  { to: '/property',  label: 'Mi Vivienda',   icon: '🏡', end: false },
  { to: '/calendar',  label: 'Mi Calendario', icon: '📅', end: false },
  { to: '/offers',    label: 'Mis Ofertas',   icon: '💼', end: false },
  { to: '/team',      label: 'Mi Equipo',     icon: '👥', end: false },
]

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function MainLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const handleNotifClick = async (notif: AppNotification) => {
    await markAsRead(notif.id)
    setNotifOpen(false)
    navigate(NOTIF_ROUTE[notif.type] ?? '/')
  }

  const userName = user?.user_metadata?.first_name
    ?? user?.email?.split('@')[0]
    ?? 'Usuario'

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-30 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-14">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 rounded-lg text-[#1A1A1A] hover:bg-gray-100 transition-colors"
          aria-label="Abrir menú"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <span className="font-bold text-[#2E5EA1] text-lg">Herohome</span>

        {/* Bell button */}
        <button
          onClick={() => setNotifOpen((o) => !o)}
          className="relative p-2 rounded-lg text-[#1A1A1A] hover:bg-gray-100 transition-colors"
          aria-label="Notificaciones"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-[#DC3545] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </header>

      {/* Notification overlay */}
      {notifOpen && (
        <div className="fixed inset-0 z-[35] bg-black/20" onClick={() => setNotifOpen(false)} />
      )}

      {/* Notification panel */}
      {notifOpen && (
        <div className="fixed top-14 right-0 left-0 sm:left-auto sm:w-80 z-[36] bg-white border-b sm:border sm:rounded-b-2xl sm:mr-2 shadow-xl max-h-[70vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-[#1A1A1A]">Notificaciones</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-[#2E5EA1] font-medium"
              >
                Marcar todo como leído
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-[#666666]">No tienes notificaciones nuevas</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleNotifClick(notif)}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 text-left"
                >
                  <span className="text-xl shrink-0 mt-0.5">{NOTIF_ICON[notif.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] leading-tight">
                      {NOTIF_LABEL[notif.type]}
                    </p>
                    <p className="text-xs text-[#666666] mt-0.5">{timeAgo(notif.created_at)}</p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-[#2E5EA1] shrink-0 mt-1.5" />
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-72 bg-white shadow-xl flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="bg-[#2E5EA1] px-6 pt-10 pb-6">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-white text-xl font-bold mb-3">
            {userName[0].toUpperCase()}
          </div>
          <p className="text-white font-semibold text-base">{userName}</p>
          <p className="text-white/70 text-sm">{user?.email}</p>
        </div>

        <nav className="flex-1 px-4 py-6 flex flex-col gap-1">
          {navItems.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive ? 'bg-[#2E5EA1]/10 text-[#2E5EA1]' : 'text-[#1A1A1A] hover:bg-gray-100'
                }`
              }
            >
              <span className="text-lg">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 pb-8">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#DC3545] hover:bg-red-50 transition-colors"
          >
            <span className="text-lg">🚪</span>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 mt-14">
        <Outlet />
      </main>
    </div>
  )
}

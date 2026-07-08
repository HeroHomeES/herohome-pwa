import { useNavigate } from 'react-router-dom'
import { useProperty } from '../hooks/useProperty'
import { useAuth } from '../context/AuthContext'
import { HerohomeSymbol } from '../components/HerohomeLogo'
import { IconCheck, IconPhone, IconLogOut } from '../components/icons'

// Defaults cuando la vivienda no tiene agente configurado (properties.agent_*).
// Se configuran por vivienda desde el Table Editor: agent_name, agent_photo_url,
// agent_calendar_url.
const DEFAULT_AGENT_NAME = 'Alejandro Yuste'
// MISMO enlace que AGENT_CALENDAR_URL de chat-with-hero y HUMAN_CALL_URL del
// whatsapp-agent. Si se cambia, actualizarlo en esos tres sitios.
const DEFAULT_AGENT_CALENDAR_URL =
  'https://calendar.google.com/calendar/appointments/schedules/AcZssZ3hWuWzgWVUdcFdrr9SS_yHlwFpH6EpRTCnZAQqfGFmA26hAAqHW3pvLlwZ-dDB3ePfLqZeWfIQ'

const HERO_FUNCTIONS = [
  'Responde a todos los interesados en menos de 1 minuto, a cualquier hora',
  'Resuelve sus dudas sobre tu vivienda',
  'Agenda las visitas según tu disponibilidad',
  'Registra las ofertas y te avisa al instante',
]

const AGENT_FUNCTIONS = [
  'Te acompaña en la contratación y en la preparación del anuncio',
  'Responde tus dudas cuando lo necesites',
  'Gestiona el contrato de arras hasta la firma',
]

function CheckItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <IconCheck size={15} strokeWidth={2.5} className="shrink-0 mt-0.5 text-violet" />
      <span className="text-sm text-slate leading-snug">{text}</span>
    </li>
  )
}

// Avatar de Hero: símbolo Pulse sobre violeta (claramente una IA, nunca una foto de persona).
function HeroAvatar() {
  return (
    <div className="w-16 h-16 rounded-full bg-violet flex items-center justify-center shrink-0">
      <HerohomeSymbol size={30} onViolet />
    </div>
  )
}

function AgentAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`Foto de ${name}`}
        className="w-16 h-16 rounded-full object-cover shrink-0 border border-line"
      />
    )
  }
  return (
    <div className="w-16 h-16 rounded-full bg-ink-2 flex items-center justify-center shrink-0">
      <span className="text-white text-2xl font-semibold">{name[0]?.toUpperCase() ?? 'H'}</span>
    </div>
  )
}

export default function TeamPage() {
  const { property } = useProperty()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const agentName = property?.agent_name || DEFAULT_AGENT_NAME
  const agentPhotoUrl = property?.agent_photo_url || null
  const agentCalendarUrl = property?.agent_calendar_url || DEFAULT_AGENT_CALENDAR_URL

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-4 pt-5 pb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet">Mi equipo</p>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ink mt-0.5">Quién vende tu casa</h1>
        <p className="text-sm text-slate mt-1.5">
          Conoce al equipo que trabaja en la venta de tu vivienda.
        </p>
      </div>

      <div className="px-4 pb-10 flex flex-col gap-4">
        {/* Hero — agente IA */}
        <section className="bg-white rounded-xl border border-line p-5">
          <div className="flex items-center gap-4">
            <HeroAvatar />
            <div>
              <h2 className="text-base font-semibold text-ink">Hero</h2>
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-violet-light text-violet-dark text-[11px] font-semibold">
                Agente IA · disponible 24/7
              </span>
            </div>
          </div>
          <ul className="mt-4 flex flex-col gap-2.5">
            {HERO_FUNCTIONS.map((f) => (
              <CheckItem key={f} text={f} />
            ))}
          </ul>
        </section>

        {/* Agente humano */}
        <section className="bg-white rounded-xl border border-line p-5">
          <div className="flex items-center gap-4">
            <AgentAvatar name={agentName} photoUrl={agentPhotoUrl} />
            <div>
              <h2 className="text-base font-semibold text-ink">{agentName}</h2>
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-teal-light text-teal text-[11px] font-semibold">
                Tu agente personal
              </span>
            </div>
          </div>
          <ul className="mt-4 flex flex-col gap-2.5">
            {AGENT_FUNCTIONS.map((f) => (
              <CheckItem key={f} text={f} />
            ))}
          </ul>
          <a
            href={agentCalendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-[7px] bg-violet hover:bg-violet-dark text-white text-[13px] font-medium transition-colors"
          >
            <IconPhone size={16} />
            Solicitar llamada con mi agente
          </a>
        </section>

        {/* Cuenta */}
        <section className="bg-white rounded-xl border border-line p-5">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet mb-3">Tu cuenta</h2>
          <p className="text-sm text-ink font-medium">
            {user?.user_metadata?.first_name ?? user?.email?.split('@')[0] ?? 'Usuario'}
          </p>
          <p className="text-xs text-slate-light mt-0.5">{user?.email}</p>
          <button
            onClick={handleSignOut}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-[7px] border border-line text-error text-[13px] font-medium hover:bg-error-bg transition-colors"
          >
            <IconLogOut size={16} />
            Cerrar sesión
          </button>
        </section>
      </div>
    </div>
  )
}

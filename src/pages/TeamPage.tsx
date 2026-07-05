import { useProperty } from '../hooks/useProperty'

// Defaults cuando la vivienda no tiene agente configurado (properties.agent_*).
// Se configuran por vivienda desde el Table Editor: agent_name, agent_photo_url,
// agent_calendar_url.
const DEFAULT_AGENT_NAME = 'Alejandro Yuste'
const DEFAULT_AGENT_CALENDAR_URL = 'https://calendar.app.google/PuJQpTUbAmTX5hjk8'

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
      <svg
        className="w-4 h-4 shrink-0 mt-0.5 text-[#2E5EA1]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span className="text-sm text-[#666666] leading-snug">{text}</span>
    </li>
  )
}

// Avatar de Hero: ilustración (claramente una IA, nunca una foto de persona).
function HeroAvatar() {
  return (
    <div className="w-16 h-16 rounded-full bg-[#2E5EA1]/10 flex items-center justify-center shrink-0">
      <svg className="w-8 h-8 text-[#2E5EA1]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="7" width="14" height="11" rx="3" />
        <line x1="12" y1="7" x2="12" y2="4" />
        <circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none" />
        <path d="M9.5 15.2c.7.6 1.6.9 2.5.9s1.8-.3 2.5-.9" />
      </svg>
    </div>
  )
}

function AgentAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`Foto de ${name}`}
        className="w-16 h-16 rounded-full object-cover shrink-0 border border-gray-200"
      />
    )
  }
  return (
    <div className="w-16 h-16 rounded-full bg-[#2E5EA1] flex items-center justify-center shrink-0">
      <span className="text-white text-2xl font-bold">{name[0]?.toUpperCase() ?? 'H'}</span>
    </div>
  )
}

export default function TeamPage() {
  const { property } = useProperty()

  const agentName = property?.agent_name || DEFAULT_AGENT_NAME
  const agentPhotoUrl = property?.agent_photo_url || null
  const agentCalendarUrl = property?.agent_calendar_url || DEFAULT_AGENT_CALENDAR_URL

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold text-[#1A1A1A]">Mi Equipo</h1>
        <p className="text-sm text-[#666666] mt-1">
          Conoce al equipo que trabaja en la venta de tu vivienda.
        </p>
      </div>

      <div className="px-4 pb-10 flex flex-col gap-4">
        {/* Hero — agente IA */}
        <section className="rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-4">
            <HeroAvatar />
            <div>
              <h2 className="text-base font-bold text-[#1A1A1A]">Hero</h2>
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-[#2E5EA1]/10 text-[#2E5EA1] text-xs font-semibold">
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
        <section className="rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-4">
            <AgentAvatar name={agentName} photoUrl={agentPhotoUrl} />
            <div>
              <h2 className="text-base font-bold text-[#1A1A1A]">{agentName}</h2>
              <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
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
            className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#2E5EA1] text-white text-sm font-semibold hover:bg-[#264E86] transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            Solicitar llamada con mi agente
          </a>
        </section>
      </div>
    </div>
  )
}

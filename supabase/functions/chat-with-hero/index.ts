import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { alertTeam } from "../_shared/alert.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!

const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`
// Sonnet 4.6: mejor disciplina de tool-calling (igual que el agente de WhatsApp).
const CLAUDE_MODEL = "claude-sonnet-4-6"
const MAX_TOOL_ITERATIONS = 5
const MAX_HISTORY_MESSAGES = 20

// Asesor humano por defecto: agenda + email (cierre garantista). Si la vivienda
// tiene agente asignado (properties.agent_name / agent_calendar_url, sección
// "Mi Equipo"), esos valores tienen prioridad en el prompt.
const AGENT_CALENDAR_URL = "https://calendar.app.google/PuJQpTUbAmTX5hjk8"
const AGENT_EMAIL = "hola@herohome.es"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Decodifica el sub (user_id) del JWT ya verificado por el gateway (verify_jwt=true).
// NUNCA se confía en ids del cliente: solo en este sub.
function getUserIdFromJWT(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    if (payload.role === "service_role") return null
    return payload.sub ?? null
  } catch {
    return null
  }
}

function formatMadrid(iso: string): string {
  const d = new Date(iso)
  const fecha = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long",
  }).format(d)
  const hora = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d)
  return `${fecha} a las ${hora}`
}

function todayMadrid(): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date())
}

// --- Anthropic types (subset) ---

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}
interface AnthropicResponse {
  stop_reason: string
  content: AnthropicContentBlock[]
}

// --- Llamada interna a otras Edge Functions (escrituras y disponibilidad) ---
// anon Bearer satisface al gateway (verify_jwt=true); x-api-key es la auth real.

async function callInternalFunction(path: string, init: RequestInit) {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "x-api-key": HEROHOME_API_KEY,
      "Content-Type": "application/json",
    },
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// --- Tools ---

const TOOLS = [
  {
    name: "get_visits",
    description:
      "Consulta las visitas de la vivienda del propietario. Úsala cuando pregunte por sus visitas (próximas confirmadas, pendientes de confirmar o pasadas).",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["pending", "upcoming", "past", "all"],
          description: "pending = pendientes de confirmar; upcoming = próximas confirmadas; past = pasadas; all = todas (por defecto).",
        },
      },
      required: [],
    },
  },
  {
    name: "get_availability",
    description: "Devuelve los huecos libres (disponibles) de la vivienda en los próximos días, agrupados por día.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_offers",
    description:
      "Consulta las ofertas recibidas sobre la vivienda, contraofertas y sus estados. Solo informativo: NO puedes actuar sobre ellas.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "confirm_visit",
    description:
      "Confirma una visita que está pendiente de confirmar. Avisa automáticamente al interesado. Pide confirmación explícita al propietario antes de llamarla.",
    input_schema: {
      type: "object",
      properties: { visit_id: { type: "string", description: "id de la visita a confirmar (de get_visits)." } },
      required: ["visit_id"],
    },
  },
  {
    name: "cancel_visit",
    description:
      "Cancela una visita (pendiente o confirmada), solo con 24h o más de antelación. Avisa automáticamente al interesado para que reagende. Pide confirmación explícita antes de llamarla.",
    input_schema: {
      type: "object",
      properties: { visit_id: { type: "string", description: "id de la visita a cancelar (de get_visits)." } },
      required: ["visit_id"],
    },
  },
  {
    name: "block_slots",
    description:
      "Bloquea (marca como no disponibles) todos los huecos libres de un rango de fechas, cuando el propietario no quiere hacer visitas esos días. Pide confirmación explícita antes de llamarla. NO sirve para crear huecos nuevos: para abrir disponibilidad, indícale que use la sección de Disponibilidad de la app.",
    input_schema: {
      type: "object",
      properties: {
        from_date: { type: "string", description: "Fecha de inicio del rango, formato YYYY-MM-DD (hora de Madrid)." },
        to_date: { type: "string", description: "Fecha de fin del rango (incluida), formato YYYY-MM-DD." },
      },
      required: ["from_date", "to_date"],
    },
  },
]

interface ToolContext {
  propertyId: string
  supabase: ReturnType<typeof createClient>
}

async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  if (name === "get_visits") {
    const filter = typeof input.filter === "string" ? input.filter : "all"
    const nowISO = new Date().toISOString()
    // deno-lint-ignore no-explicit-any
    const shape = (v: any) => ({
      visit_id: v.id,
      cuando: formatMadrid(v.start_time),
      estado: v.status,
      interesado: [v.visitor_name, v.visitor_last_name].filter(Boolean).join(" ") || "Sin nombre",
    })
    const out: Record<string, unknown> = {}
    if (filter === "pending" || filter === "all") {
      const { data } = await ctx.supabase.from("visit_slots").select("*")
        .eq("property_id", ctx.propertyId).eq("status", "Pending to confirm").order("start_time")
      out.pendientes_de_confirmar = (data ?? []).map(shape)
    }
    if (filter === "upcoming" || filter === "all") {
      const { data } = await ctx.supabase.from("visit_slots").select("*")
        .eq("property_id", ctx.propertyId).eq("status", "Confirmed").gte("start_time", nowISO).order("start_time")
      out.proximas_confirmadas = (data ?? []).map(shape)
    }
    if (filter === "past" || filter === "all") {
      const { data } = await ctx.supabase.from("visit_slots").select("*")
        .eq("property_id", ctx.propertyId).in("status", ["Confirmed", "Completed"]).lt("start_time", nowISO)
        .order("start_time", { ascending: false })
      out.pasadas = (data ?? []).map(shape)
    }
    return out
  }

  if (name === "get_availability") {
    const { data } = await callInternalFunction(
      `get-available-slots?property_id=${ctx.propertyId}&days_ahead=21`,
      { method: "GET" }
    )
    return data
  }

  if (name === "get_offers") {
    const { data } = await ctx.supabase.from("offers")
      .select("amount, status, initiated_by, buyer_name, created_at")
      .eq("property_id", ctx.propertyId).order("created_at", { ascending: false })
    return {
      ofertas: (data ?? []).map((o) => ({
        importe: o.amount != null ? `${Number(o.amount).toLocaleString("es-ES")} €` : null,
        estado: o.status,
        iniciada_por: o.initiated_by === "Owner" ? "el propietario (contraoferta)" : "el comprador",
        comprador: o.buyer_name ?? "Sin nombre",
        fecha: o.created_at ? formatMadrid(o.created_at) : null,
      })),
      nota: "Solo informativo. Para aceptar, rechazar o contraofertar, el propietario debe ir a la sección Ofertas.",
    }
  }

  if (name === "confirm_visit") {
    const visitId = typeof input.visit_id === "string" ? input.visit_id : ""
    if (!visitId) return { error: "Falta el id de la visita." }
    const { data } = await callInternalFunction("manage-visit", {
      method: "POST",
      body: JSON.stringify({ visit_slot_id: visitId, action: "confirm", property_id: ctx.propertyId }),
    })
    return data
  }

  if (name === "cancel_visit") {
    const visitId = typeof input.visit_id === "string" ? input.visit_id : ""
    if (!visitId) return { error: "Falta el id de la visita." }
    // Regla de 24h (política de Hero): leer el slot (scoped a la vivienda) y comprobar.
    const { data: slot } = await ctx.supabase.from("visit_slots")
      .select("id, property_id, start_time").eq("id", visitId).maybeSingle()
    if (!slot || slot.property_id !== ctx.propertyId) {
      return { error: "No encuentro esa visita entre las de tu vivienda." }
    }
    const hoursUntil = (new Date(slot.start_time as string).getTime() - Date.now()) / 3_600_000
    if (hoursUntil < 24) {
      return {
        error: "No puedo cancelar una visita con menos de 24 horas de antelación. Para ese caso, sugiere agendar una llamada con el asesor.",
      }
    }
    const { data } = await callInternalFunction("manage-visit", {
      method: "POST",
      body: JSON.stringify({ visit_slot_id: visitId, action: "cancel", property_id: ctx.propertyId }),
    })
    return data
  }

  if (name === "block_slots") {
    const from_date = typeof input.from_date === "string" ? input.from_date : ""
    const to_date = typeof input.to_date === "string" ? input.to_date : ""
    if (!from_date || !to_date) return { error: "Necesito la fecha de inicio y de fin (YYYY-MM-DD)." }
    const { data } = await callInternalFunction("block-visit-slots", {
      method: "POST",
      body: JSON.stringify({ property_id: ctx.propertyId, from_date, to_date }),
    })
    return data
  }

  return { error: `Unknown tool: ${name}` }
}

// --- System prompt ---

// deno-lint-ignore no-explicit-any
function buildPropertySummary(p: any): string {
  const address = [p.street, p.city, p.state, p.postal_code].filter(Boolean).join(", ")
  return [
    `- Dirección: ${address || "no disponible"}`,
    p.housing_type ? `- Tipo: ${p.housing_type}` : null,
    p.sales_price != null ? `- Precio de venta publicado: ${Number(p.sales_price).toLocaleString("es-ES")} €` : null,
    p.rooms != null ? `- Habitaciones: ${p.rooms}` : null,
    p.bathrooms != null ? `- Baños: ${p.bathrooms}` : null,
    p.built_area != null ? `- Superficie construida: ${p.built_area} m²` : null,
    p.condition ? `- Estado: ${p.condition}` : null,
    p.status ? `- Estado de la venta: ${p.status}` : null,
  ].filter(Boolean).join("\n")
}

// deno-lint-ignore no-explicit-any
function buildSystemPrompt(property: any): string {
  // Agente humano de la vivienda (sección "Mi Equipo"); fallback a los defaults.
  const calendarUrl = (property.agent_calendar_url as string | null) || AGENT_CALENDAR_URL
  const agentName = (property.agent_name as string | null) || null
  const advisorLabel = agentName ? `su asesor personal, ${agentName}` : "su asesor personal"

  return `Eres Hero, el asistente de Herohome (la primera agencia inmobiliaria 100% digital de España). Hablas por el chat de la app con el PROPIETARIO (el vendedor) y le ayudas a gestionar la venta de su vivienda. Responde siempre en español, con un tono cercano, profesional y breve.

Hoy es ${todayMadrid()} (hora de Madrid).

La vivienda del propietario:
${buildPropertySummary(property)}

Tu objetivo es ayudarle con su calendario de visitas y mantenerle informado de sus ofertas.

Qué PUEDES hacer (con tus tools):
- Informarle de sus visitas: próximas confirmadas, pendientes de confirmar y pasadas (get_visits).
- Informarle de su disponibilidad: los huecos libres de los próximos días (get_availability).
- Informarle de las ofertas recibidas, contraofertas y estados (get_offers).
- Confirmar una visita pendiente de confirmar (confirm_visit).
- Cancelar una visita con 24h o más de antelación (cancel_visit); al cancelar se avisa al interesado para que reagende.
- Bloquear los huecos de un rango de fechas si no quiere hacer visitas esos días (block_slots).

Qué NO puedes hacer:
- NO puedes actuar sobre las ofertas (aceptar, rechazar ni contraofertar). Si te lo piden, discúlpate y dile que debe hacerlo él mismo en la sección "Ofertas" de la app.
- Si te pide consejo sobre si aceptar o rechazar una oferta, dile que es una decisión muy relevante y sugiérele hablar con ${advisorLabel} agendando una llamada: ${calendarUrl} (o escribiendo a ${AGENT_EMAIL}). No le aconsejes tú qué decidir.
- NO puedes crear huecos nuevos ni cambiar su disponibilidad recurrente (la plantilla semanal). Para abrir disponibilidad o cambiarla de forma permanente, indícale que lo haga en la sección de Disponibilidad de la app. Tú solo puedes bloquear huecos puntuales (block_slots).

Reglas:
- GARANTISTA: ante cualquier duda de si puedes o debes hacer algo, NO lo hagas; discúlpate y sugiérele agendar una llamada con ${advisorLabel} (${calendarUrl} o ${AGENT_EMAIL}).
- CONFIRMACIÓN: antes de ejecutar cualquier acción que cambie datos (confirm_visit, cancel_visit, block_slots), describe en lenguaje claro el cambio exacto y pide confirmación explícita. Llama a la tool SOLO tras un "sí" claro del propietario. Para consultas (get_*) no hace falta confirmación.
- ANTI-ALUCINACIÓN: nunca digas que has confirmado, cancelado o bloqueado algo salvo que la tool correspondiente te haya devuelto éxito en ESTE mismo turno. Si una tool devuelve un error, explícaselo con naturalidad y, si procede, sugiere el asesor. No te inventes visitas, fechas, ofertas ni importes: usa solo lo que devuelven las tools.
- Cuando una tool de acción devuelva error por la regla de 24h u otra restricción, NO insistas: traslada el motivo y ofrece la alternativa (p. ej. el asesor).`
}

// --- Anthropic call ---

async function callClaude(system: string, messages: unknown[]): Promise<AnthropicResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system, messages, tools: TOOLS }),
  })
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${errBody}`)
  }
  return await res.json()
}

// --- Tool-calling loop ---

const ACTION_TOOLS = new Set(["confirm_visit", "cancel_visit", "block_slots"])

async function runToolLoop(
  system: string,
  messages: unknown[],
  context: ToolContext
): Promise<{ finalText: string; actionOk: boolean }> {
  let finalText = ""
  let actionOk = false

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude(system, messages)

    if (response.stop_reason !== "tool_use") {
      finalText = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim()
      break
    }

    messages.push({ role: "assistant", content: response.content })

    const toolResults = []
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name && block.id) {
        const result = await executeTool(block.name, block.input ?? {}, context)
        if (ACTION_TOOLS.has(block.name) && (result as { success?: boolean })?.success === true) {
          actionOk = true
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) })
      }
    }
    messages.push({ role: "user", content: toolResults })
  }

  return { finalText, actionOk }
}

// Afirmaciones en primera persona de acción completada ("he confirmado",
// "la he cancelado", "queda(n) bloqueada(s)"). Evita falsos positivos con
// descripciones de estado tipo "tienes una visita confirmada".
const ACTION_CLAIM_REGEX =
  /\b(?:(?:ya\s+)?(?:la|lo|las|los)\s+he|(?:ya\s+)?he|queda[ns]?)\s+(?:confirmad|cancelad|bloquead|anulad)[oa]s?\b/i

// --- Handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  const auth = req.headers.get("Authorization") ?? ""
  const userId = getUserIdFromJWT(auth.replace("Bearer ", ""))
  if (!userId) return jsonResponse({ error: "No autorizado" }, 401)

  let body: { message?: string; session_id?: string | null }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Cuerpo JSON inválido" }, 400)
  }
  const userText = (body.message ?? "").trim()
  if (!userText) return jsonResponse({ error: "Falta el mensaje" }, 400)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    // Vivienda del propietario (filtrado SIEMPRE por el user_id del JWT verificado).
    const { data: properties } = await supabase.from("properties").select("*").eq("user_id", userId)
    // OJO: la BD guarda "On sale" (minúscula, valor que envía Salesforce).
    const property = (properties ?? []).find((p) => p.status === "On sale") ?? (properties ?? [])[0]
    if (!property) {
      return jsonResponse({
        message: `No encuentro ninguna vivienda asociada a tu cuenta. Si crees que es un error, escríbenos a ${AGENT_EMAIL} o agenda una llamada con tu asesor: ${AGENT_CALENDAR_URL}`,
      }, 200)
    }

    // Historial (solo lectura, validado: la sesión debe ser de este usuario).
    let history: { role: string; content: string }[] = []
    if (body.session_id) {
      const { data: session } = await supabase
        .from("pwa_chat_sessions").select("messages, user_id").eq("id", body.session_id).maybeSingle()
      if (session && session.user_id === userId && Array.isArray(session.messages)) {
        const mapped = (session.messages as { role?: string; content?: unknown }[])
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
          .map((m) => ({ role: m.role as string, content: m.content as string }))
        const firstUser = mapped.findIndex((m) => m.role === "user")
        history = (firstUser === -1 ? [] : mapped.slice(firstUser)).slice(-MAX_HISTORY_MESSAGES)
      }
    }

    const system = buildSystemPrompt(property)
    const context: ToolContext = { propertyId: property.id as string, supabase }
    const messages: unknown[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText },
    ]

    let { finalText, actionOk } = await runToolLoop(system, messages, context)

    // Guardarraíl anti-alucinación: si afirma una acción completada sin éxito real
    // de la tool en este turno, corregimos y reintentamos; si persiste, fallback seguro.
    if (ACTION_CLAIM_REGEX.test(finalText) && !actionOk) {
      messages.push({ role: "assistant", content: finalText })
      messages.push({
        role: "user",
        content:
          "[CORRECCIÓN DEL SISTEMA] No has ejecutado ninguna acción con éxito en este turno, así que NO puedes decir que has confirmado, cancelado o bloqueado nada. Si el propietario lo pidió y lo confirmó, llama a la tool correspondiente; si falta su confirmación o algún dato, pídeselo. No afirmes una acción sin éxito real de la tool.",
      })
      const retry = await runToolLoop(system, messages, context)
      actionOk = actionOk || retry.actionOk
      if (retry.finalText) finalText = retry.finalText
      if (ACTION_CLAIM_REGEX.test(finalText) && !actionOk) {
        finalText = "Perdona, no he llegado a realizar esa acción. ¿Me confirmas qué quieres que haga y lo intento de nuevo?"
      }
    }

    if (!finalText) {
      finalText = "Lo siento, no he podido procesar tu mensaje. ¿Puedes reformularlo?"
    }
    return jsonResponse({ message: finalText }, 200)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[chat-with-hero] Error:", msg)
    // El canal del propietario no debe fallar en silencio hacia el equipo.
    await alertTeam({
      source: "chat-with-hero",
      subject: "Error atendiendo al propietario en el chat de la PWA",
      detail: `user_id: ${userId}\n${msg}`,
    })
    return jsonResponse({ error: "Hero no está disponible en este momento." }, 500)
  }
})

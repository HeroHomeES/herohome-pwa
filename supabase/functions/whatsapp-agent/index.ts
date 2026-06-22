import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendWhatsAppText } from "../_shared/send-whatsapp.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!

const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`
const CLAUDE_MODEL = "claude-haiku-4-5"
const MAX_TOOL_ITERATIONS = 5

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-hub-signature-256, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

// --- WhatsApp webhook payload types ---

interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
}

interface WhatsAppValue {
  contacts?: { profile?: { name?: string }; wa_id: string }[]
  messages?: WhatsAppMessage[]
}

interface WhatsAppWebhookBody {
  entry?: { changes?: { value?: WhatsAppValue }[] }[]
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

// --- Signature verification ---

async function isValidSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false
  const expectedHex = signatureHeader.slice("sha256=".length)

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  const computedHex = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  if (computedHex.length !== expectedHex.length) return false
  let mismatch = 0
  for (let i = 0; i < computedHex.length; i++) {
    mismatch |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i)
  }
  return mismatch === 0
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: "get_available_slots",
    description:
      "Devuelve los próximos horarios de visita disponibles para la vivienda de esta conversación, agrupados por día.",
    input_schema: {
      type: "object",
      properties: {
        days_ahead: {
          type: "integer",
          description: "Número de días hacia adelante a consultar. Por defecto 14.",
        },
      },
      required: [],
    },
  },
  {
    name: "request_visit",
    description:
      "Reserva una visita para la vivienda en el horario indicado (slot_id). Solo se debe llamar después de que el comprador haya facilitado su nombre completo y su email, y haya aceptado expresamente los términos y condiciones (consentimiento RGPD).",
    input_schema: {
      type: "object",
      properties: {
        slot_id: {
          type: "string",
          description: "ID del horario elegido, obtenido de get_available_slots",
        },
        visitor_name: { type: "string", description: "Nombre del comprador" },
        visitor_last_name: { type: "string", description: "Apellidos del comprador" },
        visitor_email: {
          type: "string",
          description: "Email del comprador. OBLIGATORIO para reservar (se usará para enviarle información, ofertas y el contrato).",
        },
        consent_given: {
          type: "boolean",
          description:
            "true únicamente si el comprador ha aceptado explícitamente los términos y condiciones en la conversación",
        },
      },
      required: ["slot_id", "visitor_name", "visitor_last_name", "visitor_email", "consent_given"],
    },
  },
  {
    name: "cancel_visit_by_visitor",
    description:
      "Cancela la visita que el comprador tiene reservada para esta vivienda. Úsala cuando el comprador pida cancelar o anular su visita. Si tiene varias visitas y aún no ha dicho cuál, llámala SIN slot_id: devolverá la lista (campo visits, con display y slot_id) para que le preguntes cuál cancelar.",
    input_schema: {
      type: "object",
      properties: {
        slot_id: {
          type: "string",
          description:
            "ID del horario a cancelar. Solo necesario si el comprador tiene varias visitas y ya ha elegido cuál (lo obtienes del campo slot_id del resultado previo de esta misma tool).",
        },
      },
      required: [],
    },
  },
]

// --- Internal Edge Function calls (tools) ---

async function callInternalFunction(path: string, init: RequestInit) {
  const res = await fetch(`${FUNCTIONS_BASE_URL}/${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      // The internal tool functions run with verify_jwt=true, so the Supabase
      // gateway requires a valid JWT. The anon key satisfies the gateway; the
      // function's own x-api-key check is the real authorization.
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "x-api-key": HEROHOME_API_KEY,
      "Content-Type": "application/json",
    },
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: { propertyId: string | null; waPhoneNumber: string; supabase: ReturnType<typeof createClient> }
): Promise<unknown> {
  if (name === "get_available_slots") {
    if (!context.propertyId) {
      return { error: "No hay una vivienda asociada a esta conversación todavía." }
    }
    const daysAhead = typeof input.days_ahead === "number" ? input.days_ahead : 14
    const { data } = await callInternalFunction(
      `get-available-slots?property_id=${context.propertyId}&days_ahead=${daysAhead}`,
      { method: "GET" }
    )
    return data
  }

  if (name === "request_visit") {
    const { slot_id, visitor_name, visitor_last_name, visitor_email, consent_given } = input

    if (consent_given === true) {
      await context.supabase.from("consents").insert({
        wa_phone_number: context.waPhoneNumber,
        type: "visit_request",
        accepted: true,
        ip_or_channel: "whatsapp",
        privacy_policy_version: "1.0",
      })
    }

    const { data, status } = await callInternalFunction("request-visit-slot", {
      method: "POST",
      body: JSON.stringify({
        slot_id,
        visitor_name,
        visitor_last_name,
        visitor_phone: context.waPhoneNumber,
        visitor_email: visitor_email ?? null,
        consent_given,
      }),
    })
    return { http_status: status, ...data }
  }

  if (name === "cancel_visit_by_visitor") {
    if (!context.propertyId) {
      return { error: "No hay una vivienda asociada a esta conversación todavía." }
    }
    const reqBody: Record<string, unknown> = {
      wa_phone_number: context.waPhoneNumber,
      property_id: context.propertyId,
    }
    if (typeof input.slot_id === "string") reqBody.slot_id = input.slot_id
    const { data } = await callInternalFunction("cancel-visit-by-visitor", {
      method: "POST",
      body: JSON.stringify(reqBody),
    })
    return data
  }

  return { error: `Unknown tool: ${name}` }
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
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system,
      messages,
      tools: TOOLS,
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Anthropic API ${res.status}: ${errBody}`)
  }

  return await res.json()
}

function buildSystemPrompt(property: { street?: string; city?: string; sales_price?: number } | null): string {
  const propertyContext = property
    ? `La vivienda sobre la que está consultando este comprador es: ${[property.street, property.city]
        .filter(Boolean)
        .join(", ")}${property.sales_price ? `, precio ${property.sales_price} €` : ""}.`
    : "Todavía no hay una vivienda asociada a esta conversación: si el comprador pregunta por una vivienda concreta, indícale que te escriba desde el anuncio de Idealista correspondiente para poder ayudarle."

  return `Eres Hero, el asistente conversacional de Herohome, una inmobiliaria. Hablas por WhatsApp con un potencial comprador (PC) interesado en una vivienda. Responde siempre en español, con un tono cercano, profesional y breve (mensajes cortos, propios de WhatsApp).

${propertyContext}

Tu objetivo es ayudar al comprador a consultar disponibilidad de visitas, reservar una, y cancelar o reagendar su visita si lo necesita.

Reglas importantes:
- NUNCA digas que una visita está reservada o confirmada salvo que la tool request_visit te haya devuelto un resultado de éxito en ESTE mismo turno. Está terminantemente prohibido inventar o anticipar una confirmación.
- Procedimiento OBLIGATORIO para reservar una visita, en este orden:
  1. Reúne el nombre, los apellidos y el email del comprador, y su consentimiento explícito a los términos y condiciones. El email es OBLIGATORIO (lo necesitaremos para enviarle información, ofertas o el contrato): si no lo facilita, pídeselo y NO continúes con la reserva hasta tenerlo. Para el consentimiento pregúntale: "¿Aceptas nuestros términos y condiciones para gestionar tu visita? https://www.herohome.es/terminos-y-condiciones". Usa consent_given=true solo si responde afirmativamente.
  2. Llama a get_available_slots para obtener los slot_id ACTUALES. Los slot_id NO se conservan entre mensajes, así que debes volver a pedirlos llamando a la tool justo antes de reservar, aunque ya hubieras mostrado los horarios antes.
  3. Localiza en el resultado el slot_id que corresponde EXACTAMENTE al día y la hora que eligió el comprador.
  4. Llama a request_visit con ese slot_id, el nombre, los apellidos y consent_given.
  5. Confirma la reserva ÚNICAMENTE si request_visit devolvió éxito: dile que su solicitud ha quedado registrada y que el propietario la confirmará en breve, y que recibirá el aviso (por WhatsApp y por email) cuando esté confirmada. Si request_visit devolvió error (p.ej. el hueco ya no está disponible), discúlpate y ofrécele otro horario.
- Para CANCELAR una visita, usa la tool cancel_visit_by_visitor:
  - Si devuelve needs_selection (el comprador tiene varias visitas), muéstrale las opciones (usa el campo display de cada una) y pregúntale cuál quiere cancelar; luego vuelve a llamar a la tool con el slot_id elegido.
  - Si devuelve no_visits, dile amablemente que no consta ninguna visita activa a su nombre.
  - Si la cancelación tiene ÉXITO, confírmasela y a continuación OFRÉCELE REAGENDAR: llama a get_available_slots y muéstrale los horarios disponibles, preguntándole si quiere reservar una nueva visita. Si acepta, sigue el procedimiento de reserva de arriba.
- Para mostrar disponibilidad usa get_available_slots y presenta los horarios agrupados por día.
- No inventes horarios, propiedades ni datos que no provengan de las tools.
- NUNCA digas que has enviado un email ni que realizas acciones fuera de tus tools: solo puedes consultar horarios y solicitar visitas. El aviso de confirmación al comprador (WhatsApp + email) lo envía el sistema automáticamente cuando el propietario confirma la visita, no tú.
- Si no hay vivienda asociada a la conversación, no llames a las tools de visitas; pide al comprador que contacte desde el anuncio de la vivienda en Idealista.
- No solicites el DNI del comprador: no es necesario para reservar una visita.`
}

// --- Main handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  // Meta webhook verification
  if (req.method === "GET") {
    const url = new URL(req.url)
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")

    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200, headers: corsHeaders })
    }

    return new Response("Forbidden", { status: 403, headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const rawBody = await req.text()
  const signature = req.headers.get("x-hub-signature-256")

  if (!(await isValidSignature(rawBody, signature))) {
    console.error("[whatsapp-agent] Firma X-Hub-Signature-256 inválida")
    return new Response("Forbidden", { status: 403, headers: corsHeaders })
  }

  let payload: WhatsAppWebhookBody
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response("OK", { status: 200, headers: corsHeaders })
  }

  const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]

  // No incoming message (e.g. delivery/read status update) — acknowledge and exit
  if (!message) {
    return new Response("OK", { status: 200, headers: corsHeaders })
  }

  const waPhoneNumber = message.from
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    if (message.type !== "text" || !message.text?.body) {
      await sendWhatsAppText({
        to: waPhoneNumber,
        body: "Por ahora solo puedo leer mensajes de texto. ¿Puedes escribirme tu consulta?",
      })
      return new Response("OK", { status: 200, headers: corsHeaders })
    }

    const userText = message.text.body

    // Load conversation (most recent for this phone number)
    const { data: conversation } = await supabase
      .from("whatsapp_conversations")
      .select("id, property_id, messages")
      .eq("wa_phone_number", waPhoneNumber)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const propertyId: string | null = conversation?.property_id ?? null

    let property: { street?: string; city?: string; sales_price?: number } | null = null
    if (propertyId) {
      const { data } = await supabase
        .from("properties")
        .select("street, city, sales_price")
        .eq("id", propertyId)
        .maybeSingle()
      property = data
    }

    const history: { role: string; content: string }[] = Array.isArray(conversation?.messages)
      ? (conversation!.messages as { role: string; content: string }[])
      : []

    // The Anthropic Messages API requires the first message to have role "user".
    // process-idealista-lead seeds new conversations with a leading "assistant"
    // message (the welcome template) — drop any leading non-user messages.
    let firstUserIdx = 0
    while (firstUserIdx < history.length && history[firstUserIdx].role !== "user") {
      firstUserIdx++
    }

    const anthropicMessages: unknown[] = [
      ...history.slice(firstUserIdx).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText },
    ]

    const system = buildSystemPrompt(property)

    let finalText = ""
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await callClaude(system, anthropicMessages)

      if (response.stop_reason !== "tool_use") {
        finalText = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim()
        break
      }

      anthropicMessages.push({ role: "assistant", content: response.content })

      const toolResults = []
      for (const block of response.content) {
        if (block.type === "tool_use" && block.name && block.id) {
          const result = await executeTool(block.name, block.input ?? {}, {
            propertyId,
            waPhoneNumber,
            supabase,
          })
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        }
      }
      anthropicMessages.push({ role: "user", content: toolResults })
    }

    if (!finalText) {
      finalText = "Disculpa, no he podido procesar tu mensaje. ¿Puedes repetirlo?"
    }

    await sendWhatsAppText({ to: waPhoneNumber, body: finalText })

    await callInternalFunction("save-message", {
      method: "POST",
      body: JSON.stringify({
        wa_phone_number: waPhoneNumber,
        property_id: propertyId,
        messages: [
          { role: "user", content: userText },
          { role: "assistant", content: finalText },
        ],
      }),
    })

    return new Response("OK", { status: 200, headers: corsHeaders })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[whatsapp-agent] Error:", message)
    await sendWhatsAppText({
      to: waPhoneNumber,
      body: "Disculpa, he tenido un problema técnico. Inténtalo de nuevo en unos minutos.",
    }).catch(() => {})
    return new Response("OK", { status: 200, headers: corsHeaders })
  }
})

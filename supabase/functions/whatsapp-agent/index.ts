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
// Sonnet 4.6: mejor disciplina de tool-calling que Haiku para el agente conversacional.
const CLAUDE_MODEL = "claude-sonnet-4-6"
const MAX_TOOL_ITERATIONS = 5

// --- Gate de honorarios del comprador (B13 → integrado en B5) ---

// % de comisión del comprador por defecto si la vivienda no tiene valor (1 = 1%).
const DEFAULT_BUYER_FEE_PERCENT = 1

// Texto de honorarios (plantilla categoría UTILITY). Lo construye el CÓDIGO con el
// porcentaje de la vivienda (properties.buyer_fee_percent): NO lo genera ni lo
// parafrasea el LLM. Se envía verbatim al PC y se guarda en consents.consent_text
// para trazabilidad legal. El % es invariable por vivienda (decisión de negocio).
function formatFeePercent(pct: number): string {
  // 1 → "1"; 0.5 → "0,5" (coma decimal en español, sin ceros sobrantes).
  return Number.isInteger(pct) ? String(pct) : String(pct).replace(".", ",")
}

// Importe en euros con formato español ("3.000 €").
function formatEur(amount: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount)
}

// salesPrice se pasa para mostrar un € ORIENTATIVO. Es opcional: si no se conoce
// (o en gates abiertos antes de añadir este dato a agent_state) el mensaje sale
// solo con el %, idéntico al texto histórico → consent_text retrocompatible.
function buildFeeMessage(pct: number, salesPrice: number | null = null): string {
  const amount = pct > 0 && salesPrice && salesPrice > 0 ? Math.round((salesPrice * pct) / 100) : null
  const estimate =
    amount != null
      ? ` Sobre el precio actual de ${formatEur(salesPrice!)}, supondría aproximadamente ${formatEur(amount)}; el importe final se calculará sobre el precio que finalmente se acuerde con el vendedor.`
      : ""
  return `Antes de confirmar tu visita, necesito que conozcas las condiciones del servicio:

Herohome cobra una comisión del ${formatFeePercent(pct)}% sobre el precio de venta al comprador. Esta comisión se devenga si formalizas una oferta de compra sobre esta propiedad que es aceptada por el vendedor.${estimate}

Puedes consultar las condiciones completas en: herohome.es/honorarios

¿Aceptas estas condiciones para continuar? Responde SÍ para confirmar tu visita.`
}

const FEE_CONSENT_TYPE = "buyer_fee_acknowledgement"

// Mensaje cuando el PC RECHAZA los honorarios (o segundo mensaje ambiguo).
const FEE_GATE_REJECTION_MESSAGE =
  "Entendido, no hay problema. Si cambias de opinión o quieres saber más sobre cómo funciona Herohome, escríbeme cuando quieras."

// Mensaje cuando falla técnicamente el registro del consentimiento.
const FEE_GATE_ERROR_MESSAGE =
  "Ha habido un problema técnico al procesar tu solicitud. Por favor, inténtalo de nuevo en unos minutos o escríbenos a hola@herohome.es."

// Confirmación tras aceptar honorarios y reservar con éxito.
const FEE_GATE_BOOKED_MESSAGE =
  "¡Perfecto! Tu solicitud de visita ha quedado registrada. El propietario la confirmará en breve y recibirás el aviso por WhatsApp y por email. ¡Gracias por confiar en Herohome!"

// El comprador aceptó pero el hueco ya no estaba disponible (carrera).
const FEE_GATE_SLOT_TAKEN_MESSAGE =
  "Vaya, ese horario acaba de ocuparse. ¿Quieres que te muestre otros huecos disponibles para tu visita?"

// Clasificación determinista de la respuesta del PC al gate (normalizada a
// minúsculas + trim antes de evaluar). Sin LLM: robustez legal.
const FEE_ACCEPT_TOKENS = new Set(["sí", "si", "acepto", "ok", "vale", "perfecto", "confirmo"])
const FEE_ACCEPT_PHRASES = ["de acuerdo"]
const FEE_REJECT_TOKENS = new Set(["no", "cancelar"])
const FEE_REJECT_PHRASES = ["no acepto"]

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

// --- Tool context (compartido por executeTool y el loop) ---

interface FeeGate {
  slotId: string
  visitorName: string
  visitorLastName: string
  visitorEmail: string
  feePercent: number
  salesPrice: number | null
}

interface ToolContext {
  propertyId: string | null
  waPhoneNumber: string
  supabase: ReturnType<typeof createClient>
  // % de comisión del comprador de la vivienda (1 = 1%). 0 = sin gate.
  buyerFeePercent: number
  // Precio de venta de la vivienda (para el € orientativo del mensaje de honorarios).
  salesPrice: number | null
  // Cuando request_visit reúne todos los datos, en vez de reservar marca aquí el
  // gate de honorarios; el handler lo detecta tras el loop y envía el mensaje.
  feeGate: FeeGate | null
}

// Estado persistido en whatsapp_conversations.agent_state durante el gate.
type AgentState = {
  state: "awaiting_fee_consent"
  pending_property_id: string | null
  pending_slot_id: string
  visitor_name: string
  visitor_last_name: string
  visitor_email: string
  fee_percent: number
  // Precio de venta congelado al abrir el gate: el € del consent_text se reconstruye
  // con este valor (no se recalcula desde la vivienda) para que coincida verbatim.
  sales_price?: number | null
  retries: number
  gate_sent_at: string
} | null

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
      "Inicia la reserva de una visita para la vivienda en el horario indicado (slot_id). Llámala cuando el comprador ya haya facilitado su nombre completo y su email, y haya aceptado los términos y condiciones (consentimiento RGPD). Al llamarla, el sistema presentará automáticamente al comprador las condiciones de honorarios (comisión del 1% al comprador) y completará la reserva SOLO si el comprador las acepta. No confirmes ni des por hecha la reserva tú mismo tras llamarla.",
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
  {
    name: "create_offer",
    description:
      "Registra una oferta de compra del comprador sobre la vivienda de esta conversación. Úsala cuando el comprador quiera hacer una oferta. Antes de llamarla necesitas DOS datos: el importe de la oferta en euros y el DNI del comprador (obligatorio para formalizar la oferta; solo se pide al ofertar, nunca para una visita). El propietario decidirá después; NO confirmes que la oferta ha sido aceptada.",
    input_schema: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Importe de la oferta en euros (solo el número, sin símbolo ni separadores).",
        },
        dni: { type: "string", description: "DNI o NIE del comprador. Obligatorio para formalizar la oferta." },
      },
      required: ["amount", "dni"],
    },
  },
  {
    name: "respond_to_counteroffer",
    description:
      "El comprador responde a una contraoferta viva del propietario ACEPTÁNDOLA o RECHAZÁNDOLA. Úsala solo si el contexto indica que hay una contraoferta del propietario pendiente. Si el comprador quiere proponer un importe distinto en vez de aceptar o rechazar, usa create_offer. NO confirmes el resultado antes de que la tool devuelva éxito.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["accept", "reject"],
          description:
            "accept si el comprador acepta la contraoferta del propietario; reject si la rechaza y cierra la negociación.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "save_visit_feedback",
    description:
      "Guarda el feedback del comprador tras su visita. Úsala cuando, tras una visita, el comprador te diga si le interesa la vivienda o no (y por qué). outcome='not_interested' si no le encaja (incluye el motivo en feedback), 'interested' si le interesa.",
    input_schema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["interested", "not_interested"],
          description: "interested si le interesa la vivienda; not_interested si no le encaja.",
        },
        feedback: {
          type: "string",
          description: "Lo que el comprador haya dicho sobre la vivienda (motivo de su decisión). Opcional.",
        },
      },
      required: ["outcome"],
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
  context: ToolContext
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

    // Gate de honorarios (B13): NO se reserva aquí. Cuando el agente tiene los datos
    // del comprador y el slot elegido, en vez de reservar marcamos el gate: el handler
    // enviará el texto EXACTO de honorarios y pasará a awaiting_fee_consent. La reserva
    // real (request-visit-slot) se hace solo si el comprador acepta (respuesta SÍ).
    if (consent_given !== true) {
      return {
        error:
          "Falta el consentimiento de términos y condiciones (RGPD). Pídeselo al comprador antes de continuar.",
      }
    }
    if (
      typeof slot_id !== "string" ||
      typeof visitor_name !== "string" ||
      typeof visitor_last_name !== "string" ||
      typeof visitor_email !== "string" ||
      !visitor_email
    ) {
      return {
        error:
          "Faltan datos para reservar (slot, nombre, apellidos o email). Reúnelos antes de continuar.",
      }
    }

    // Vivienda con 0% de comisión: no hay nada que aceptar → reservamos directo
    // (sin gate ni consentimiento de honorarios), como antes del gate.
    if (context.buyerFeePercent <= 0) {
      await context.supabase.from("consents").insert({
        wa_phone_number: context.waPhoneNumber,
        type: "visit_request",
        accepted: true,
        ip_or_channel: "whatsapp",
        privacy_policy_version: "1.0",
        property_id: context.propertyId,
        visit_slot_id: slot_id,
      })
      const { data, status } = await callInternalFunction("request-visit-slot", {
        method: "POST",
        body: JSON.stringify({
          slot_id,
          visitor_name,
          visitor_last_name,
          visitor_phone: context.waPhoneNumber,
          visitor_email,
          consent_given: true,
        }),
      })
      return { http_status: status, ...data }
    }

    // Vivienda con comisión > 0: en vez de reservar, abrimos el gate de honorarios.
    context.feeGate = {
      slotId: slot_id,
      visitorName: visitor_name,
      visitorLastName: visitor_last_name,
      visitorEmail: visitor_email,
      feePercent: context.buyerFeePercent,
      salesPrice: context.salesPrice,
    }
    return {
      fee_gate: "presented",
      note: "Se han mostrado al comprador las condiciones de honorarios. El sistema procesa su respuesta automáticamente. No confirmes ninguna reserva en este turno.",
    }
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

  if (name === "create_offer") {
    if (!context.propertyId) {
      return { error: "No hay una vivienda asociada a esta conversación todavía." }
    }
    const amount = typeof input.amount === "number" ? input.amount : Number(input.amount)
    const dni = typeof input.dni === "string" ? input.dni.trim() : ""
    if (!amount || amount <= 0) {
      return { error: "Falta el importe de la oferta (un número en euros mayor que 0). Pídeselo al comprador." }
    }
    if (!dni) {
      return { error: "Falta el DNI del comprador (obligatorio para formalizar la oferta). Pídeselo." }
    }
    const { data } = await callInternalFunction("create-offer", {
      method: "POST",
      body: JSON.stringify({
        property_id: context.propertyId,
        wa_phone_number: context.waPhoneNumber,
        amount,
        dni,
      }),
    })
    return data
  }

  if (name === "respond_to_counteroffer") {
    if (!context.propertyId) {
      return { error: "No hay una vivienda asociada a esta conversación todavía." }
    }
    const action = input.action === "accept" || input.action === "reject" ? input.action : null
    if (!action) {
      return { error: "action debe ser 'accept' o 'reject'." }
    }
    const { data } = await callInternalFunction("respond-counteroffer", {
      method: "POST",
      body: JSON.stringify({
        property_id: context.propertyId,
        wa_phone_number: context.waPhoneNumber,
        action,
      }),
    })
    return data
  }

  if (name === "save_visit_feedback") {
    if (!context.propertyId) {
      return { error: "No hay una vivienda asociada a esta conversación todavía." }
    }
    const outcome =
      input.outcome === "interested" || input.outcome === "not_interested" ? input.outcome : null
    if (!outcome) {
      return { error: "outcome debe ser 'interested' o 'not_interested'." }
    }
    const feedback = typeof input.feedback === "string" ? input.feedback : ""
    const { data } = await callInternalFunction("save-visit-feedback", {
      method: "POST",
      body: JSON.stringify({
        property_id: context.propertyId,
        wa_phone_number: context.waPhoneNumber,
        outcome,
        feedback,
      }),
    })
    return data
  }

  return { error: `Unknown tool: ${name}` }
}

// --- Gate de honorarios: helpers (deterministas, sin LLM) ---

// Clasifica la respuesta del PC al mensaje de honorarios. El rechazo se evalúa
// primero para que "no acepto" gane sobre el token "acepto".
function classifyFeeReply(text: string): "accept" | "reject" | "ambiguous" {
  const norm = text.toLowerCase().trim()
  const tokens = new Set(norm.split(/[^a-záéíóúñü]+/i).filter(Boolean))
  if (FEE_REJECT_PHRASES.some((p) => norm.includes(p))) return "reject"
  for (const t of FEE_REJECT_TOKENS) if (tokens.has(t)) return "reject"
  if (FEE_ACCEPT_PHRASES.some((p) => norm.includes(p))) return "accept"
  for (const t of FEE_ACCEPT_TOKENS) if (tokens.has(t)) return "accept"
  return "ambiguous"
}

// Registra el consentimiento de honorarios en `consents` con trazabilidad
// completa (texto exacto + wamid del mensaje del PC). Devuelve ok=false si el
// INSERT falla: en ese caso NO se debe reservar la visita.
async function recordFeeConsent(
  supabase: ReturnType<typeof createClient>,
  params: { waPhoneNumber: string; propertyId: string | null; slotId: string; waMessageId: string | null; consentText: string }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("consents").insert({
    wa_phone_number: params.waPhoneNumber,
    type: FEE_CONSENT_TYPE,
    accepted: true,
    ip_or_channel: "whatsapp",
    privacy_policy_version: "1.0",
    property_id: params.propertyId,
    visit_slot_id: params.slotId,
    consent_text: params.consentText,
    wa_message_id: params.waMessageId,
    // created_at: default now()
  })
  if (error) {
    console.error("[whatsapp-agent] recordFeeConsent INSERT falló:", error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

// Escribe (o limpia con state=null) el estado del gate en la conversación.
async function setAgentState(
  supabase: ReturnType<typeof createClient>,
  waPhoneNumber: string,
  propertyId: string | null,
  state: AgentState
): Promise<void> {
  let q = supabase
    .from("whatsapp_conversations")
    .update({ agent_state: state })
    .eq("wa_phone_number", waPhoneNumber)
  q = propertyId ? q.eq("property_id", propertyId) : q.is("property_id", null)
  const { error } = await q
  if (error) console.error("[whatsapp-agent] setAgentState falló:", error.message)
}

// Persiste el turno (mensaje del PC + respuesta de Hero) vía save-message.
async function saveTurn(
  waPhoneNumber: string,
  propertyId: string | null,
  userText: string,
  assistantText: string
): Promise<void> {
  await callInternalFunction("save-message", {
    method: "POST",
    body: JSON.stringify({
      wa_phone_number: waPhoneNumber,
      property_id: propertyId,
      messages: [
        { role: "user", content: userText },
        { role: "assistant", content: assistantText },
      ],
    }),
  })
}

// Envía el texto EXACTO de honorarios y deja la conversación en awaiting_fee_consent.
async function enterFeeGate(
  supabase: ReturnType<typeof createClient>,
  waPhoneNumber: string,
  propertyId: string | null,
  feeGate: FeeGate,
  userText: string
): Promise<void> {
  const feeMessage = buildFeeMessage(feeGate.feePercent, feeGate.salesPrice)
  await sendWhatsAppText({ to: waPhoneNumber, body: feeMessage })
  await setAgentState(supabase, waPhoneNumber, propertyId, {
    state: "awaiting_fee_consent",
    pending_property_id: propertyId,
    pending_slot_id: feeGate.slotId,
    visitor_name: feeGate.visitorName,
    visitor_last_name: feeGate.visitorLastName,
    visitor_email: feeGate.visitorEmail,
    fee_percent: feeGate.feePercent,
    sales_price: feeGate.salesPrice,
    retries: 0,
    gate_sent_at: new Date().toISOString(),
  })
  await saveTurn(waPhoneNumber, propertyId, userText, feeMessage)
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

function buildSystemPrompt(property: { street?: string; city?: string; sales_price?: number } | null, buyerContext: string): string {
  const propertyContext = property
    ? `La vivienda sobre la que está consultando este comprador es: ${[property.street, property.city]
        .filter(Boolean)
        .join(", ")}${property.sales_price ? `, precio ${property.sales_price} €` : ""}.`
    : "Todavía no hay una vivienda asociada a esta conversación: si el comprador pregunta por una vivienda concreta, indícale que te escriba desde el anuncio de Idealista correspondiente para poder ayudarle."

  return `Eres Hero, el asistente conversacional de Herohome, una inmobiliaria. Hablas por WhatsApp con un potencial comprador (PC) interesado en una vivienda. Responde siempre en español, con un tono cercano, profesional y breve (mensajes cortos, propios de WhatsApp).

${propertyContext}
${buyerContext ? `\n${buyerContext}\n` : ""}
Tu objetivo es ayudar al comprador a consultar disponibilidad de visitas, reservar una, cancelar o reagendar su visita, y registrar una oferta de compra si decide comprar.

Reglas importantes:
- NUNCA digas que una visita está reservada o confirmada salvo que la tool request_visit te haya devuelto un resultado de éxito en ESTE mismo turno. Está terminantemente prohibido inventar o anticipar una confirmación. Esto aplica SIEMPRE, incluso al REAGENDAR o si ya tienes los datos del comprador de un paso anterior: tener el nombre, el email y el consentimiento NO reserva nada; solo request_visit con éxito reserva. Para CADA reserva (incluida la nueva tras reagendar) debes volver a llamar a get_available_slots y a request_visit.
- No anuncies que vas a reservar (p.ej. "Reservando…", "un momento, por favor") terminando tu turno sin actuar: si toca reservar, LLAMA a request_visit en ESE MISMO turno. No existe un "luego"; en cada turno o completas la acción con la tool o pides el dato que falte.
- Procedimiento OBLIGATORIO para reservar una visita, en este orden:
  1. Reúne el nombre, los apellidos y el email del comprador, y su consentimiento explícito a los términos y condiciones. El email es OBLIGATORIO (lo necesitaremos para enviarle información, ofertas o el contrato): si no lo facilita, pídeselo y NO continúes con la reserva hasta tenerlo. Para el consentimiento pregúntale: "¿Aceptas nuestros términos y condiciones para gestionar tu visita? https://www.herohome.es/terminos-y-condiciones". Usa consent_given=true solo si responde afirmativamente.
  2. Llama a get_available_slots para obtener los slot_id ACTUALES. Los slot_id NO se conservan entre mensajes, así que debes volver a pedirlos llamando a la tool justo antes de reservar, aunque ya hubieras mostrado los horarios antes.
  3. Localiza en el resultado el slot_id que corresponde EXACTAMENTE al día y la hora que eligió el comprador.
  4. Llama a request_visit con ese slot_id, el nombre, los apellidos, el email y consent_given.
  5. Al llamar a request_visit, el sistema mostrará automáticamente al comprador las condiciones de honorarios (comisión del 1% al comprador) y procesará su respuesta (SÍ/NO) por su cuenta. NO escribas tú esas condiciones, NO las parafrasees y NO digas que la visita está reservada ni registrada en ese turno: la reserva solo se completa si el comprador acepta los honorarios, y de eso se encarga el sistema. Si request_visit devuelve un error por falta de datos, reúne lo que falte y vuelve a intentarlo.
- Para CANCELAR una visita, usa la tool cancel_visit_by_visitor:
  - Si devuelve needs_selection (varias visitas), muéstrale las opciones (campo display) y pregúntale cuál; luego vuelve a llamar con el slot_id elegido.
  - Si devuelve no_visits: SOLO dile que no consta ninguna visita activa a su nombre si lo que pedía era CANCELAR. Si está reagendando o quiere reservar un nuevo horario, NO menciones que no tiene visitas; continúa y reserva el horario elegido con el procedimiento de reserva.
  - Si la cancelación tiene ÉXITO, confírmasela y OFRÉCELE REAGENDAR: llama a get_available_slots, muéstrale los horarios y pregúntale si quiere reservar otra visita.
- REAGENDAR = cancelar la visita actual UNA sola vez (cancel_visit_by_visitor) y luego reservar la nueva. Una vez cancelada, para la nueva reserva usa SOLO get_available_slots + request_visit; NO vuelvas a llamar a cancel_visit_by_visitor.
- Para registrar una OFERTA de compra del comprador, usa la tool create_offer:
  - Necesitas el IMPORTE de la oferta (en euros) y el DNI del comprador. Si falta alguno, pídeselo antes de llamarla. El DNI es OBLIGATORIO para formalizar la oferta (lo necesitaremos para el contrato); solo se pide al ofertar, nunca para una visita.
  - Llama a create_offer con el importe y el DNI. NUNCA digas que la oferta ha sido aceptada: la decisión es del propietario, que responderá. Tras un create_offer con éxito, dile al comprador que su oferta ha quedado registrada y que el propietario le responderá pronto.
  - Si create_offer devuelve below_threshold=true, dile con tacto que su oferta podría quedar por debajo de lo que pide el propietario, pero que se la trasladamos igualmente.
- Si el contexto indica que el propietario tiene una CONTRAOFERTA pendiente, el comprador puede aceptarla, rechazarla o proponer un importe nuevo:
  - Si la ACEPTA o la RECHAZA, usa respond_to_counteroffer con action="accept" o "reject". No confirmes el resultado hasta que la tool devuelva éxito (al aceptar, dile que el equipo se pondrá en contacto para los siguientes pasos; al rechazar, despídete amablemente).
  - Si propone un IMPORTE NUEVO, usa create_offer con ese importe y el DNI, igual que una oferta normal.
- Cuando el comprador responda a un mensaje de "¿qué te ha parecido la visita?" (tras haber visitado):
  - Si muestra interés o quiere ofertar, ayúdale a hacer su oferta (procedimiento de create_offer).
  - Si dice que NO le interesa, pregúntale con amabilidad qué es lo que no le ha encajado ("Entiendo, ¿podrías decirme qué es lo que no te ha convencido?"). Cuando te responda (o si no quiere decírtelo), llama a save_visit_feedback con outcome="not_interested" y feedback con lo que te haya dicho, y despídete amablemente.
  - Si te confirma que le interesa pero todavía no quiere ofertar, registra save_visit_feedback con outcome="interested".
- Para mostrar disponibilidad usa get_available_slots y presenta los horarios agrupados por día.
- No inventes horarios, propiedades ni datos que no provengan de las tools.
- NUNCA digas que has enviado un email ni que realizas acciones fuera de tus tools: solo puedes consultar horarios, gestionar visitas y registrar ofertas con tus tools. El aviso de confirmación al comprador (WhatsApp + email) lo envía el sistema automáticamente cuando el propietario confirma la visita, no tú.
- Si no hay vivienda asociada a la conversación, no llames a las tools de visitas; pide al comprador que contacte desde el anuncio de la vivienda en Idealista.
- No pidas el DNI para una VISITA (no hace falta). El DNI solo se solicita al registrar una OFERTA de compra (tool create_offer).`
}

// Resumen del estado de la negociación del comprador (ofertas vivas) para
// inyectarlo en el system prompt: evita ofertas duplicadas y permite a Hero
// reconocer una contraoferta del propietario pendiente de respuesta.
async function loadBuyerContext(
  supabase: ReturnType<typeof createClient>,
  propertyId: string | null,
  waPhoneNumber: string
): Promise<string> {
  if (!propertyId) return ""
  const { data: offers } = await supabase
    .from("offers")
    .select("initiated_by, amount, status, created_at")
    .eq("property_id", propertyId)
    .eq("buyer_phone", waPhoneNumber)
    .order("created_at", { ascending: false })
  if (!offers || offers.length === 0) return ""

  const pendingOwner = offers.find((o) => o.status === "Presented" && o.initiated_by === "Owner")
  const pendingBuyer = offers.find((o) => o.status === "Presented" && o.initiated_by === "Buyer")
  if (pendingOwner) {
    return `Estado de la negociación: el propietario ha hecho una CONTRAOFERTA de ${pendingOwner.amount} € pendiente de la respuesta del comprador. Si la acepta o la rechaza, usa respond_to_counteroffer; si propone un importe nuevo, usa create_offer.`
  }
  if (pendingBuyer) {
    return `Estado de la negociación: el comprador ya tiene una oferta de ${pendingBuyer.amount} € presentada y pendiente de respuesta del propietario. No registres otra oferta igual salvo que quiera cambiar el importe.`
  }
  return ""
}

// --- Tool-calling loop ---

async function runToolLoop(
  system: string,
  messages: unknown[],
  context: ToolContext
): Promise<{ finalText: string; requestVisitOk: boolean; offerActionOk: boolean }> {
  let finalText = ""
  let requestVisitOk = false
  let offerActionOk = false

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude(system, messages)

    if (response.stop_reason !== "tool_use") {
      finalText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim()
      break
    }

    messages.push({ role: "assistant", content: response.content })

    const toolResults = []
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name && block.id) {
        const result = await executeTool(block.name, block.input ?? {}, context)
        if (block.name === "request_visit" && (result as { success?: boolean })?.success === true) {
          requestVisitOk = true
        }
        if (block.name === "create_offer" && (result as { success?: boolean })?.success === true) {
          offerActionOk = true
        }
        if (block.name === "respond_to_counteroffer" && (result as { success?: boolean })?.success === true) {
          offerActionOk = true
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      }
    }
    messages.push({ role: "user", content: toolResults })
  }

  return { finalText, requestVisitOk, offerActionOk }
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
      .select("id, property_id, messages, agent_state")
      .eq("wa_phone_number", waPhoneNumber)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const propertyId: string | null = conversation?.property_id ?? null

    // ---- Gate de honorarios: estado awaiting_fee_consent (determinista, sin LLM) ----
    // Si la conversación está esperando la respuesta del PC al mensaje de honorarios,
    // NO pasamos por el LLM: clasificamos su respuesta y resolvemos el gate.
    const agentState = (conversation?.agent_state ?? null) as AgentState
    if (agentState && agentState.state === "awaiting_fee_consent") {
      const decision = classifyFeeReply(userText)

      // --- ACEPTA: registrar consentimiento de honorarios y reservar ---
      if (decision === "accept") {
        // Reconstruimos el texto EXACTO mostrado a partir del % guardado al abrir
        // el gate (no se recalcula desde la vivienda: garantiza que lo registrado
        // coincide con lo que vio el comprador).
        const consentText = buildFeeMessage(agentState.fee_percent, agentState.sales_price ?? null)
        const consentRes = await recordFeeConsent(supabase, {
          waPhoneNumber,
          propertyId: agentState.pending_property_id,
          slotId: agentState.pending_slot_id,
          waMessageId: message.id ?? null,
          consentText,
        })

        // Si el INSERT del consentimiento falla: NO reservar. Avisar y mantener el
        // gate abierto para que el PC pueda reintentar respondiendo de nuevo.
        if (!consentRes.ok) {
          await sendWhatsAppText({ to: waPhoneNumber, body: FEE_GATE_ERROR_MESSAGE })
          await saveTurn(waPhoneNumber, propertyId, userText, FEE_GATE_ERROR_MESSAGE)
          return new Response("OK", { status: 200, headers: corsHeaders })
        }

        // Consentimiento RGPD de la visita (se conserva el registro previo de B5).
        await supabase.from("consents").insert({
          wa_phone_number: waPhoneNumber,
          type: "visit_request",
          accepted: true,
          ip_or_channel: "whatsapp",
          privacy_policy_version: "1.0",
          property_id: agentState.pending_property_id,
          visit_slot_id: agentState.pending_slot_id,
        })

        // Reserva real (ahora sí: el slot pasa de Available → Pending to confirm).
        const { data: bookData } = await callInternalFunction("request-visit-slot", {
          method: "POST",
          body: JSON.stringify({
            slot_id: agentState.pending_slot_id,
            visitor_name: agentState.visitor_name,
            visitor_last_name: agentState.visitor_last_name,
            visitor_phone: waPhoneNumber,
            visitor_email: agentState.visitor_email,
            consent_given: true,
          }),
        })

        const reply =
          (bookData as { success?: boolean })?.success === true
            ? FEE_GATE_BOOKED_MESSAGE
            : FEE_GATE_SLOT_TAKEN_MESSAGE
        await sendWhatsAppText({ to: waPhoneNumber, body: reply })
        await setAgentState(supabase, waPhoneNumber, propertyId, null)
        await saveTurn(waPhoneNumber, propertyId, userText, reply)
        return new Response("OK", { status: 200, headers: corsHeaders })
      }

      // --- RECHAZA: cerrar. El slot nunca se reservó, sigue Available ---
      if (decision === "reject") {
        await sendWhatsAppText({ to: waPhoneNumber, body: FEE_GATE_REJECTION_MESSAGE })
        await setAgentState(supabase, waPhoneNumber, propertyId, null)
        await saveTurn(waPhoneNumber, propertyId, userText, FEE_GATE_REJECTION_MESSAGE)
        return new Response("OK", { status: 200, headers: corsHeaders })
      }

      // --- AMBIGUO: 1 reintento; al segundo mensaje ambiguo, tratar como rechazo ---
      if ((agentState.retries ?? 0) < 1) {
        const feeMessage = buildFeeMessage(agentState.fee_percent, agentState.sales_price ?? null)
        await sendWhatsAppText({ to: waPhoneNumber, body: feeMessage })
        await setAgentState(supabase, waPhoneNumber, propertyId, {
          ...agentState,
          retries: (agentState.retries ?? 0) + 1,
        })
        await saveTurn(waPhoneNumber, propertyId, userText, feeMessage)
        return new Response("OK", { status: 200, headers: corsHeaders })
      }

      await sendWhatsAppText({ to: waPhoneNumber, body: FEE_GATE_REJECTION_MESSAGE })
      await setAgentState(supabase, waPhoneNumber, propertyId, null)
      await saveTurn(waPhoneNumber, propertyId, userText, FEE_GATE_REJECTION_MESSAGE)
      return new Response("OK", { status: 200, headers: corsHeaders })
    }

    let property: { street?: string; city?: string; sales_price?: number; buyer_fee_percent?: number | string | null } | null = null
    if (propertyId) {
      const { data } = await supabase
        .from("properties")
        .select("street, city, sales_price, buyer_fee_percent")
        .eq("id", propertyId)
        .maybeSingle()
      property = data
    }

    // numeric de Postgres puede llegar como string vía supabase-js → coercionar.
    const buyerFeePercent =
      property?.buyer_fee_percent != null ? Number(property.buyer_fee_percent) : DEFAULT_BUYER_FEE_PERCENT
    // numeric de Postgres puede llegar como string → coercionar (para el € orientativo).
    const salesPrice = property?.sales_price != null ? Number(property.sales_price) : null

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

    const buyerContext = await loadBuyerContext(supabase, propertyId, waPhoneNumber)
    const system = buildSystemPrompt(property, buyerContext)
    const toolContext: ToolContext = { propertyId, waPhoneNumber, supabase, feeGate: null, buyerFeePercent, salesPrice }

    let { finalText, requestVisitOk, offerActionOk } = await runToolLoop(system, anthropicMessages, toolContext)

    // ---- Entrada al gate de honorarios ----
    // request_visit reunió los datos y pidió reservar. En vez de reservar, enviamos
    // el texto EXACTO de honorarios y pasamos a awaiting_fee_consent. La reserva se
    // completará en el siguiente turno solo si el comprador acepta (rama de arriba).
    if (toolContext.feeGate) {
      await enterFeeGate(supabase, waPhoneNumber, propertyId, toolContext.feeGate, userText)
      return new Response("OK", { status: 200, headers: corsHeaders })
    }

    // Guardarraíl anti-alucinación: si el modelo afirma una reserva sin que
    // request_visit haya tenido éxito en este turno, lo corregimos para no
    // mentir al comprador (caso visto al reagendar con los datos ya recogidos).
    if (/(reserv|solicit|agend|confirm|registr)\w*(ad|and)|un momento|enseguida|procesando/i.test(finalText) && !requestVisitOk && !offerActionOk) {
      anthropicMessages.push({ role: "assistant", content: finalText })
      anthropicMessages.push({
        role: "user",
        content:
          "[CORRECCIÓN DEL SISTEMA] No has llamado a request_visit con éxito en este turno, así que NO hay ninguna reserva y NO puedes decir que la visita está reservada ni confirmada. Si el comprador ya eligió día y hora y tienes su nombre, email y consentimiento, llama a get_available_slots y luego a request_visit con el slot_id correcto. Si falta algún dato, pídeselo. No afirmes ninguna reserva sin éxito de request_visit.",
      })
      const retry = await runToolLoop(system, anthropicMessages, toolContext)
      requestVisitOk = requestVisitOk || retry.requestVisitOk
      offerActionOk = offerActionOk || retry.offerActionOk
      if (retry.finalText) finalText = retry.finalText
      // Última red de seguridad: si AÚN afirma una reserva sin éxito, no mentir.
      if (/(reserv|solicit|agend|confirm|registr)\w*(ad|and)|un momento|enseguida|procesando/i.test(finalText) && !requestVisitOk && !offerActionOk) {
        finalText =
          "Perdona, no he podido completar la reserva ahora mismo. ¿Me confirmas de nuevo el día y la hora que prefieres y lo intento otra vez?"
      }
    }

    // Si el reintento del guardarraíl fue el que disparó request_visit, entramos al
    // gate aquí (mismo helper, texto verbatim) en vez de enviar el finalText.
    if (toolContext.feeGate) {
      await enterFeeGate(supabase, waPhoneNumber, propertyId, toolContext.feeGate, userText)
      return new Response("OK", { status: 200, headers: corsHeaders })
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

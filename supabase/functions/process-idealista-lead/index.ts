import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0"
import { sendEmail } from "../_shared/send-email.ts"
import { idealistaLeadAlertHtml } from "../_shared/email-templates/idealista-lead-alert.ts"
import { sendWhatsAppTemplate } from "../_shared/send-whatsapp.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!

const ALERT_EMAIL_TO = "hola@herohome.es"
const WHATSAPP_WELCOME_TEMPLATE_NAME = Deno.env.get("WHATSAPP_WELCOME_TEMPLATE_NAME") ?? "bienvenida_pc"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface IdealistaLeadBody {
  subject?: string
  body: string
  from?: string
}

interface ExtractedLead {
  extraction_successful: boolean
  phone: string | null
  name: string | null
  property_reference: string | null
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

async function extractLeadInfo(emailBody: string, emailSubject?: string): Promise<ExtractedLead | null> {
  const userContent = [
    emailSubject ? `Asunto: ${emailSubject}` : null,
    `Cuerpo del email:\n${emailBody}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Este es un email de notificación de un lead de Idealista recibido por una inmobiliaria. Extrae el número de móvil del comprador interesado, su nombre (si aparece) y la referencia de la vivienda (el ID de Salesforce de la propiedad, que aparece en el email).\n\n${userContent}`,
        },
      ],
      tools: [
        {
          name: "extract_lead_info",
          description:
            "Registra los datos extraídos del email de lead de Idealista. Si algún dato no se puede determinar con confianza, usa null para ese campo y marca extraction_successful como false.",
          input_schema: {
            type: "object",
            properties: {
              extraction_successful: {
                type: "boolean",
                description:
                  "true solo si se han podido extraer tanto el teléfono como la referencia de la propiedad con confianza",
              },
              phone: {
                type: ["string", "null"],
                description:
                  "Número de móvil del comprador en formato E.164 (ej. +34612345678). Si el email no incluye prefijo de país, asume España (+34).",
              },
              name: {
                type: ["string", "null"],
                description: "Nombre del comprador interesado, si aparece en el email",
              },
              property_reference: {
                type: ["string", "null"],
                description: "Referencia/ID de Salesforce de la propiedad mencionada en el email",
              },
            },
            required: ["extraction_successful", "phone", "name", "property_reference"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "extract_lead_info" },
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    console.error(`[process-idealista-lead] Anthropic API respondió ${res.status}: ${errBody}`)
    return null
  }

  const data = await res.json()
  const toolUse = (data.content ?? []).find(
    (block: { type: string; name?: string }) => block.type === "tool_use" && block.name === "extract_lead_info"
  )

  if (!toolUse) {
    console.error("[process-idealista-lead] La respuesta de Anthropic no incluyó el tool_use esperado")
    return null
  }

  return toolUse.input as ExtractedLead
}

async function sendAlert(reason: string, rawSubject: string | undefined, rawBody: string, extracted?: Record<string, unknown>) {
  const html = idealistaLeadAlertHtml({ reason, extracted, rawSubject, rawBody })
  const result = await sendEmail({
    to: ALERT_EMAIL_TO,
    subject: "⚠️ Fallo al procesar lead de Idealista",
    html,
  })
  if (!result.success) {
    console.error("[process-idealista-lead] Error al enviar email de alerta:", result.error)
  }
}

function normalizePhone(rawPhone: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, "")
  if (digits.length === 9) {
    return `34${digits}`
  }
  return digits.replace(/^0+/, "")
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const apiKey = req.headers.get("x-api-key")
  if (!apiKey || apiKey !== HEROHOME_API_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: IdealistaLeadBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  if (!body.body || typeof body.body !== "string" || body.body.trim() === "") {
    return jsonResponse({ error: "body is required" }, 400)
  }

  const extracted = await extractLeadInfo(body.body, body.subject)

  if (!extracted) {
    await sendAlert("Error al llamar al modelo de extracción (Anthropic API)", body.subject, body.body)
    return jsonResponse({ success: false, alerted: true }, 200)
  }

  if (!extracted.extraction_successful || !extracted.phone || !extracted.property_reference) {
    await sendAlert(
      "El modelo no pudo extraer el teléfono y/o la referencia de la propiedad con confianza",
      body.subject,
      body.body,
      extracted as unknown as Record<string, unknown>
    )
    return jsonResponse({ success: false, alerted: true, extracted }, 200)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id, street, city")
    .eq("salesforce_account_id", extracted.property_reference)
    .maybeSingle()

  if (propertyError) {
    await sendAlert(`Error al buscar la propiedad en Supabase: ${propertyError.message}`, body.subject, body.body, extracted as unknown as Record<string, unknown>)
    return jsonResponse({ success: false, alerted: true }, 200)
  }

  if (!property) {
    await sendAlert(
      `No se ha encontrado ninguna propiedad con salesforce_account_id = "${extracted.property_reference}"`,
      body.subject,
      body.body,
      extracted as unknown as Record<string, unknown>
    )
    return jsonResponse({ success: false, alerted: true, extracted }, 200)
  }

  const waPhoneNumber = normalizePhone(extracted.phone)
  const propertyLabel = [property.street, property.city].filter(Boolean).join(", ")

  // Dedup insert-then-send: insertamos la conversación PRIMERO, apoyándonos en el
  // índice único parcial `whatsapp_conversations_phone_property_uidx`
  // (wa_phone_number, property_id) como barrera real contra carreras. Solo si la
  // fila se crea de verdad (no hubo conflicto) enviamos la bienvenida. Así el
  // índice elimina el doble envío que causaba el SELECT-then-INSERT anterior.
  const now = new Date().toISOString()
  const { data: inserted, error: insertError } = await supabase
    .from("whatsapp_conversations")
    .insert({
      wa_phone_number: waPhoneNumber,
      property_id: property.id,
      messages: [],
      last_message_at: now,
    })
    .select("id")
    .single()

  // Conflicto con el índice único (23505) => ya existe una conversación para este
  // comprador+vivienda. Otra invocación ganó la carrera (o es un lead repetido):
  // NO reenviamos la bienvenida.
  if (insertError) {
    if (insertError.code === "23505") {
      return jsonResponse(
        { success: true, action: "already_exists", property_id: property.id, wa_phone_number: waPhoneNumber },
        200
      )
    }
    return jsonResponse({ error: insertError.message }, 500)
  }

  // Ganamos la inserción: enviamos la plantilla de bienvenida.
  const whatsappResult = await sendWhatsAppTemplate({
    to: waPhoneNumber,
    templateName: WHATSAPP_WELCOME_TEMPLATE_NAME,
    bodyParams: propertyLabel ? [propertyLabel] : undefined,
  })

  if (!whatsappResult.success) {
    // El envío falló: deshacemos la fila que acabamos de crear para no dejar una
    // conversación fantasma que bloquee un reintento (el Apps Script reintenta el
    // hilo mientras no reciba 2xx). Así un fallo transitorio de WhatsApp no impide
    // que la bienvenida acabe llegando en el siguiente tick.
    await supabase.from("whatsapp_conversations").delete().eq("id", inserted.id)
    await sendAlert(
      `No se ha podido enviar la plantilla de bienvenida de WhatsApp: ${whatsappResult.error}`,
      body.subject,
      body.body,
      extracted as unknown as Record<string, unknown>
    )
    return jsonResponse({ success: false, alerted: true, extracted, whatsapp_error: whatsappResult.error }, 200)
  }

  // Bienvenida enviada: registramos la nota en el historial de la conversación.
  const { error: updateError } = await supabase
    .from("whatsapp_conversations")
    .update({
      messages: [
        {
          role: "assistant",
          content: `[plantilla ${WHATSAPP_WELCOME_TEMPLATE_NAME}] Bienvenida enviada para ${propertyLabel || "la propiedad"}`,
          ts: now,
        },
      ],
      last_message_at: now,
    })
    .eq("id", inserted.id)

  if (updateError) {
    console.error(`[process-idealista-lead] No se pudo registrar la nota de bienvenida: ${updateError.message}`)
  }

  return jsonResponse(
    { success: true, action: "created", conversation_id: inserted.id, property_id: property.id, wa_phone_number: waPhoneNumber },
    201
  )
})

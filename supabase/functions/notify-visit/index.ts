import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0"
import { sendEmail } from "../_shared/send-email.ts"
import { sendWhatsAppTemplate, sendWhatsAppText } from "../_shared/send-whatsapp.ts"
import { visitConfirmationHtml, visitCancellationHtml } from "../_shared/email-templates/visit-status.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

// Plantillas de WhatsApp (deben existir y estar aprobadas en Meta con estos
// nombres exactos y 3 variables de cuerpo: {{1}} nombre, {{2}} dirección, {{3}} fecha/hora).
const TEMPLATE_CONFIRMED = "visita_confirmada"
const TEMPLATE_CANCELED = "visita_cancelada"

function formatMadrid(iso: string): string {
  const d = new Date(iso)
  const fecha = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d)
  const hora = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)
  return `${fecha} a las ${hora}`
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  // Función INTERNA: solo la invoca manage-visit (con x-api-key). Antes bastaba
  // cualquier JWT válido (incluida la anon key pública del bundle de la PWA),
  // lo que permitía re-disparar notificaciones conociendo el UUID de una visita.
  const apiKey = req.headers.get("x-api-key")
  if (!apiKey || apiKey !== Deno.env.get("HEROHOME_API_KEY")) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: { visit_slot_id?: string; action?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const { visit_slot_id, action } = body
  if (!visit_slot_id || !action) {
    return jsonResponse({ error: "visit_slot_id y action son obligatorios" }, 400)
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // 1. Datos de la visita
  const { data: slot, error: slotError } = await supabase
    .from("visit_slots")
    .select("*")
    .eq("id", visit_slot_id)
    .single()

  if (slotError || !slot) {
    return jsonResponse({ error: `Visita no encontrada: ${slotError?.message}` }, 404)
  }

  // 2. Datos de la propiedad
  const { data: property } = await supabase
    .from("properties")
    .select("street, city")
    .eq("id", slot.property_id)
    .single()

  const isCancellation = action.toLowerCase().includes("cancel")
  const isConfirmation = action === "Confirmed"

  if (!isCancellation && !isConfirmation) {
    return jsonResponse({ success: true, notified: false, reason: `Acción "${action}" sin notificación asociada` }, 200)
  }

  const firstName = slot.visitor_name || "Visitante"
  const address =
    [property?.street, property?.city].filter(Boolean).join(", ") || "la vivienda"
  const dateTime = formatMadrid(slot.start_time)

  const result: { whatsapp: string | null; email: string | null } = { whatsapp: null, email: null }

  // 3. WhatsApp al visitante (PC): plantilla aprobada, con texto libre como
  //    fallback (válido dentro de la ventana de 24h de atención al cliente).
  if (slot.visitor_phone) {
    const templateName = isCancellation ? TEMPLATE_CANCELED : TEMPLATE_CONFIRMED
    const template = await sendWhatsAppTemplate({
      to: slot.visitor_phone,
      templateName,
      bodyParams: [firstName, address, dateTime],
    })

    if (template.success) {
      result.whatsapp = "template"
    } else {
      const text = isCancellation
        ? `Hola ${firstName}, lamentamos informarte de que tu visita a ${address} del ${dateTime} ha sido cancelada. Escríbenos por aquí y te ayudamos a reagendarla.`
        : `¡Hola ${firstName}! Tu visita a ${address} queda confirmada para el ${dateTime}. ¡Te esperamos! Si necesitas cambiarla, respóndenos por aquí.`
      const fallback = await sendWhatsAppText({ to: slot.visitor_phone, body: text })
      result.whatsapp = fallback.success ? "text_fallback" : `failed: ${template.error}`
      if (!fallback.success) {
        console.error(`[notify-visit] WhatsApp falló (plantilla y texto) para ${slot.visitor_phone}: ${template.error}`)
      }
    }
  }

  // 4. Email al visitante (PC) si tenemos dirección
  if (slot.visitor_email) {
    const html = isCancellation
      ? visitCancellationHtml({ visitorName: firstName, propertyAddress: address, dateTime })
      : visitConfirmationHtml({ visitorName: firstName, propertyAddress: address, dateTime })
    const subject = isCancellation ? "Tu visita ha sido cancelada" : "Tu visita está confirmada"
    const email = await sendEmail({ to: slot.visitor_email, subject, html })
    result.email = email.success ? "sent" : `failed: ${email.error}`
  }

  return jsonResponse({ success: true, action, notified: result }, 200)
})

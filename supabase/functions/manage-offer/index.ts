import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendEmail } from "../_shared/send-email.ts"
import { sendWhatsAppTemplate, sendWhatsAppText } from "../_shared/send-whatsapp.ts"
import {
  offerAcceptedPcHtml,
  offerDeniedPcHtml,
  offerCounterPcHtml,
  teamOfferAlertHtml,
} from "../_shared/email-templates/offer-status.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const TEAM_EMAIL = "hola@herohome.es"

// Plantillas de WhatsApp (deben existir y estar aprobadas en Meta, es_ES):
//   oferta_aceptada  → {{1}} nombre, {{2}} importe, {{3}} dirección
//   oferta_rechazada → {{1}} nombre, {{2}} dirección
//   contraoferta     → {{1}} nombre, {{2}} importe, {{3}} dirección
const TEMPLATE_ACCEPTED = "oferta_aceptada"
const TEMPLATE_DENIED = "oferta_rechazada"
const TEMPLATE_COUNTER = "contraoferta"

function formatEuros(amount: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Lee el `sub` (user id) del JWT ya verificado por el gateway (verify_jwt=true).
// No re-verifica la firma: solo decodifica el payload para el check de propiedad.
function decodeJwtSub(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null
  const parts = authHeader.slice(7).split(".")
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    return typeof payload.sub === "string" ? payload.sub : null
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  // La PWA invoca con el JWT de sesión del CV (verify_jwt=true en esta función).
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401)
  }

  let body: { offer_id?: string; action?: string; amount?: number }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const { offer_id, action, amount } = body
  if (!offer_id || !action || !["accept", "deny", "counter"].includes(action)) {
    return jsonResponse({ error: "offer_id y action (accept|deny|counter) son obligatorios" }, 400)
  }
  if (action === "counter" && (!amount || amount <= 0)) {
    return jsonResponse({ error: "amount válido (> 0) es obligatorio para una contraoferta" }, 400)
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // 1. Oferta sobre la que se actúa
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("*")
    .eq("id", offer_id)
    .single()

  if (offerError || !offer) {
    return jsonResponse({ error: `Oferta no encontrada: ${offerError?.message}` }, 404)
  }
  if (offer.status !== "Presented") {
    return jsonResponse({ error: `La oferta ya no está pendiente (estado: ${offer.status})` }, 409)
  }

  // 2. Propiedad (dueño + dirección)
  const { data: property, error: propError } = await supabase
    .from("properties")
    .select("user_id, street, city")
    .eq("id", offer.property_id)
    .single()

  if (propError || !property) {
    return jsonResponse({ error: `Vivienda no encontrada: ${propError?.message}` }, 404)
  }

  // 3. Ownership: el CV que llama debe ser el dueño de la vivienda
  const userId = decodeJwtSub(authHeader)
  if (!userId || userId !== property.user_id) {
    return jsonResponse({ error: "No autorizado sobre esta oferta" }, 403)
  }

  const address = [property.street, property.city].filter(Boolean).join(", ") || "la vivienda"
  const firstName = offer.buyer_name || "Hola"
  const nowIso = new Date().toISOString()

  // 4. Aplicar la acción
  let eventLabel: string
  let eventAmount: number = offer.amount

  if (action === "accept") {
    const { error } = await supabase
      .from("offers")
      .update({ status: "Accepted", updated_at: nowIso })
      .eq("id", offer_id)
    if (error) return jsonResponse({ error: `No se pudo aceptar la oferta: ${error.message}` }, 500)
    eventLabel = "Oferta aceptada"
  } else if (action === "deny") {
    const { error } = await supabase
      .from("offers")
      .update({ status: "Denied", updated_at: nowIso })
      .eq("id", offer_id)
    if (error) return jsonResponse({ error: `No se pudo rechazar la oferta: ${error.message}` }, 500)
    eventLabel = "Oferta rechazada"
  } else {
    // counter: rechaza la oferta del comprador e inserta la contraoferta del propietario
    const { error: denyErr } = await supabase
      .from("offers")
      .update({ status: "Denied", updated_at: nowIso })
      .eq("id", offer_id)
    if (denyErr) return jsonResponse({ error: `No se pudo registrar la contraoferta: ${denyErr.message}` }, 500)

    const { error: insertErr } = await supabase.from("offers").insert({
      property_id: offer.property_id,
      parent_offer_id: offer_id,
      initiated_by: "Owner",
      status: "Presented",
      amount,
      // Se arrastran los datos del comprador para mantener el hilo de la negociación
      buyer_name: offer.buyer_name,
      buyer_phone: offer.buyer_phone,
      buyer_email: offer.buyer_email,
      buyer_dni: offer.buyer_dni,
      created_at: nowIso,
      updated_at: nowIso,
    })
    if (insertErr) return jsonResponse({ error: `No se pudo crear la contraoferta: ${insertErr.message}` }, 500)
    eventAmount = amount!
    eventLabel = "Contraoferta enviada"
  }

  // 5. Avisar al comprador (PC): WhatsApp (plantilla + fallback texto) + email
  const result: { whatsapp: string | null; email: string | null } = { whatsapp: null, email: null }

  if (offer.buyer_phone) {
    let template: { success: boolean; error?: string }
    let fallbackText: string
    if (action === "accept") {
      template = await sendWhatsAppTemplate({
        to: offer.buyer_phone,
        templateName: TEMPLATE_ACCEPTED,
        bodyParams: [firstName, formatEuros(offer.amount), address],
      })
      fallbackText = `¡Enhorabuena ${firstName}! El propietario ha aceptado tu oferta de ${formatEuros(offer.amount)} por ${address}. Nos pondremos en contacto contigo para los siguientes pasos.`
    } else if (action === "deny") {
      template = await sendWhatsAppTemplate({
        to: offer.buyer_phone,
        templateName: TEMPLATE_DENIED,
        bodyParams: [firstName, address],
      })
      fallbackText = `Hola ${firstName}, el propietario no ha aceptado tu oferta por ${address}. Si quieres, puedes proponer una nueva oferta por aquí.`
    } else {
      template = await sendWhatsAppTemplate({
        to: offer.buyer_phone,
        templateName: TEMPLATE_COUNTER,
        bodyParams: [firstName, formatEuros(eventAmount), address],
      })
      fallbackText = `Hola ${firstName}, el propietario ha hecho una contraoferta de ${formatEuros(eventAmount)} por ${address}. ¿Quieres aceptarla, rechazarla y cerrar la negociación, o hacer una nueva oferta? Escríbeme por aquí.`
    }

    if (template.success) {
      result.whatsapp = "template"
    } else {
      const fallback = await sendWhatsAppText({ to: offer.buyer_phone, body: fallbackText })
      result.whatsapp = fallback.success ? "text_fallback" : `failed: ${template.error}`
      if (!fallback.success) {
        console.error(`[manage-offer] WhatsApp falló (plantilla y texto) para ${offer.buyer_phone}: ${template.error}`)
      }
    }
  }

  if (offer.buyer_email) {
    let html: string
    let subject: string
    if (action === "accept") {
      html = offerAcceptedPcHtml({ buyerName: firstName, propertyAddress: address, amount: offer.amount })
      subject = "¡Tu oferta ha sido aceptada!"
    } else if (action === "deny") {
      html = offerDeniedPcHtml({ buyerName: firstName, propertyAddress: address })
      subject = "Actualización sobre tu oferta"
    } else {
      html = offerCounterPcHtml({ buyerName: firstName, propertyAddress: address, amount: eventAmount })
      subject = "Has recibido una contraoferta"
    }
    const email = await sendEmail({ to: offer.buyer_email, subject, html })
    result.email = email.success ? "sent" : `failed: ${email.error}`
  }

  // 6. Aviso interno al equipo (interim del dashboard, B8)
  await sendEmail({
    to: TEAM_EMAIL,
    subject: `[Ofertas] ${eventLabel} — ${address}`,
    html: teamOfferAlertHtml({
      eventLabel,
      propertyAddress: address,
      amount: eventAmount,
      buyerName: offer.buyer_name,
      buyerPhone: offer.buyer_phone,
      buyerEmail: offer.buyer_email,
      buyerDni: offer.buyer_dni,
    }),
  })

  return jsonResponse({ success: true, action, notified: result }, 200)
})

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0"
import { sendEmail } from "../_shared/send-email.ts"
import {
  teamOfferAlertHtml,
  offerCvNewBuyerOfferHtml,
  offerCvNewOfferHtml,
} from "../_shared/email-templates/offer-status.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!
const TEAM_EMAIL = "hola@herohome.es"

const FEE_CONSENT_TYPE = "buyer_fee_acknowledgement"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface CreateOfferBody {
  property_id: string
  wa_phone_number: string
  amount: number
  dni: string
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Tool de whatsapp-agent: registra una oferta de compra del comprador (PC).
// El comprador conversa por WhatsApp; nombre y email se recuperan de su visita
// (el DNI llega aquí, solo se pide al ofertar). Avisa al CV (notificación in-app)
// y al equipo (email interino mientras no hay dashboard, B8).
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

  let body: CreateOfferBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const { property_id, wa_phone_number, amount, dni } = body
  if (!property_id || !wa_phone_number || !amount || amount <= 0 || !dni) {
    return jsonResponse(
      { error: "property_id, wa_phone_number, amount (> 0) y dni son obligatorios" },
      400
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date().toISOString()

  // 1. Propiedad (dueño + dirección + umbral de rechazo)
  const { data: property, error: propError } = await supabase
    .from("properties")
    .select("user_id, street, city, reject_offers_below")
    .eq("id", property_id)
    .maybeSingle()

  if (propError || !property) {
    return jsonResponse({ error: `Vivienda no encontrada: ${propError?.message ?? ""}` }, 404)
  }

  // 1b. Vivienda ya apalabrada: si existe una oferta aceptada, no se admiten
  //     nuevas ofertas (evita situaciones comerciales incómodas tras el acuerdo).
  //     Cualquier excepción la gestiona el equipo a mano.
  const { data: acceptedOffer } = await supabase
    .from("offers")
    .select("id")
    .eq("property_id", property_id)
    .eq("status", "Accepted")
    .limit(1)
    .maybeSingle()
  if (acceptedOffer) {
    return jsonResponse(
      {
        error:
          "Esta vivienda ya tiene una oferta aceptada, así que ahora mismo no se pueden registrar nuevas ofertas. Dile al comprador con tacto que la vivienda está apalabrada y que, si lo desea, puede escribir a hola@herohome.es para que el equipo le avise si la operación no llegara a cerrarse.",
      },
      409
    )
  }

  // 2. Nombre y email del comprador desde su visita más reciente a esta vivienda
  const { data: visit } = await supabase
    .from("visit_slots")
    .select("visitor_name, visitor_last_name, visitor_email")
    .eq("property_id", property_id)
    .eq("visitor_phone", wa_phone_number)
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle()

  const buyerName = visit
    ? [visit.visitor_name, visit.visitor_last_name].filter(Boolean).join(" ") || null
    : null
  const buyerEmail = (visit?.visitor_email as string | null) ?? null

  // 3. Reconocimiento de honorarios (se captura antes de la visita, gate B13).
  //    Si falta (caso raro), NO se bloquea la oferta: se marca para que el equipo
  //    lo revise (decisión de negocio: no complicar el flujo por el hipotético).
  const { data: feeConsent } = await supabase
    .from("consents")
    .select("id")
    .eq("type", FEE_CONSENT_TYPE)
    .eq("wa_phone_number", wa_phone_number)
    .eq("property_id", property_id)
    .eq("accepted", true)
    .limit(1)
    .maybeSingle()
  const feeAcknowledged = !!feeConsent

  // 4. ¿Hay una contraoferta viva del propietario? Entonces esta oferta es la
  //    respuesta del comprador ("nueva oferta"): se liga a ella y se cierra.
  const { data: ownerOffer } = await supabase
    .from("offers")
    .select("id")
    .eq("property_id", property_id)
    .eq("buyer_phone", wa_phone_number)
    .eq("initiated_by", "Owner")
    .eq("status", "Presented")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let parentOfferId: string | null = null
  if (ownerOffer) {
    parentOfferId = ownerOffer.id as string
    await supabase.from("offers").update({ status: "Denied", updated_at: now }).eq("id", ownerOffer.id)
  }

  // 4b. Cerrar cualquier oferta previa del PROPIO comprador que siga viva
  //     (Presented) sobre esta vivienda. Una oferta nueva sustituye a la anterior:
  //     así no se acumulan varias ofertas activas del mismo comprador (evita los
  //     duplicados por doble llamada del agente y deja siempre una única fuente de
  //     verdad). No toca ofertas de otros compradores ni la contraoferta del
  //     propietario (ya gestionada arriba, initiated_by="Owner").
  await supabase
    .from("offers")
    .update({ status: "Denied", updated_at: now })
    .eq("property_id", property_id)
    .eq("buyer_phone", wa_phone_number)
    .eq("initiated_by", "Buyer")
    .eq("status", "Presented")

  // 5. Alta de la oferta
  const { data: inserted, error: insertError } = await supabase
    .from("offers")
    .insert({
      property_id,
      parent_offer_id: parentOfferId,
      initiated_by: "Buyer",
      status: "Presented",
      amount,
      buyer_name: buyerName,
      buyer_phone: wa_phone_number,
      buyer_email: buyerEmail,
      buyer_dni: dni,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single()

  if (insertError || !inserted) {
    return jsonResponse({ error: `No se pudo registrar la oferta: ${insertError?.message ?? ""}` }, 500)
  }

  const address = [property.street, property.city].filter(Boolean).join(", ") || "la vivienda"
  const belowThreshold =
    property.reject_offers_below != null && amount < Number(property.reject_offers_below)

  // 6. Notificación in-app al propietario (CV) por Realtime
  const { error: notifError } = await supabase.from("notifications").insert({
    user_id: property.user_id,
    type: "new_offer",
    payload: { offer_id: inserted.id, property_id, amount, buyer_name: buyerName },
  })
  if (notifError) {
    console.error("[create-offer] Error insertando notificación:", notifError.message)
  }

  // 7. Aviso interno al equipo (interim del dashboard, B8)
  await sendEmail({
    to: TEAM_EMAIL,
    subject: `[Ofertas] Nueva oferta — ${address}`,
    html: teamOfferAlertHtml({
      eventLabel: parentOfferId ? "Nueva oferta del comprador (responde a contraoferta)" : "Nueva oferta del comprador",
      propertyAddress: address,
      amount,
      buyerName,
      buyerPhone: wa_phone_number,
      buyerEmail,
      buyerDni: dni,
      note: feeAcknowledged ? undefined : "⚠️ Sin reconocimiento de honorarios previo registrado",
    }),
  })

  // 8. Aviso por email al propietario (además de la notificación in-app):
  //    tiene una nueva oferta y debe entrar en la app para responder.
  if (property.user_id) {
    const { data: owner } = await supabase
      .from("users")
      .select("email, first_name")
      .eq("id", property.user_id)
      .maybeSingle()
    if (owner?.email) {
      const ownerName = (owner.first_name as string | undefined) ?? undefined
      await sendEmail({
        to: owner.email,
        subject: parentOfferId ? "El comprador ha hecho una nueva oferta" : "Has recibido una nueva oferta",
        html: parentOfferId
          ? offerCvNewBuyerOfferHtml({ ownerName, propertyAddress: address, amount })
          : offerCvNewOfferHtml({ ownerName, propertyAddress: address, amount }),
      })
    }
  }

  return jsonResponse(
    {
      success: true,
      offer_id: inserted.id,
      below_threshold: belowThreshold,
      fee_acknowledged: feeAcknowledged,
      is_counter_response: !!parentOfferId,
    },
    201
  )
})

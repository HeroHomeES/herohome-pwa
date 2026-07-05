import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0"
import { sendEmail } from "../_shared/send-email.ts"
import {
  offerCvBuyerAcceptedHtml,
  offerCvBuyerRejectedHtml,
  teamOfferAlertHtml,
} from "../_shared/email-templates/offer-status.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!
const TEAM_EMAIL = "hola@herohome.es"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface RespondBody {
  property_id: string
  wa_phone_number: string
  action: "accept" | "reject"
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Tool de whatsapp-agent: el comprador (PC) ACEPTA o RECHAZA la contraoferta
// viva del propietario. (Para proponer un importe nuevo se usa create_offer, no
// esta función.) Cierra la oferta del propietario y avisa al CV (email + in-app)
// y al equipo.
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

  let body: RespondBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const { property_id, wa_phone_number, action } = body
  if (!property_id || !wa_phone_number || (action !== "accept" && action !== "reject")) {
    return jsonResponse(
      { error: "property_id, wa_phone_number y action (accept|reject) son obligatorios" },
      400
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date().toISOString()

  // 1. Contraoferta viva del propietario para este comprador
  const { data: ownerOffer } = await supabase
    .from("offers")
    .select("id, amount, buyer_name, buyer_phone, buyer_email, buyer_dni")
    .eq("property_id", property_id)
    .eq("buyer_phone", wa_phone_number)
    .eq("initiated_by", "Owner")
    .eq("status", "Presented")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!ownerOffer) {
    // Hero lo gestiona (no hay nada que aceptar/rechazar).
    return jsonResponse({ success: false, no_pending_counteroffer: true }, 200)
  }

  // 2. Cerrar la contraoferta según la decisión del comprador
  const newStatus = action === "accept" ? "Accepted" : "Denied"
  const { error: updateError } = await supabase
    .from("offers")
    .update({ status: newStatus, updated_at: now })
    .eq("id", ownerOffer.id)
  if (updateError) {
    return jsonResponse({ error: `No se pudo actualizar la oferta: ${updateError.message}` }, 500)
  }

  // 3. Propiedad + propietario (para avisarle)
  const { data: property } = await supabase
    .from("properties")
    .select("street, city, user_id")
    .eq("id", property_id)
    .maybeSingle()

  const address = [property?.street, property?.city].filter(Boolean).join(", ") || "la vivienda"

  let ownerEmail: string | null = null
  let ownerName: string | undefined
  if (property?.user_id) {
    const { data: owner } = await supabase
      .from("users")
      .select("email, first_name")
      .eq("id", property.user_id)
      .maybeSingle()
    ownerEmail = (owner?.email as string | null) ?? null
    ownerName = (owner?.first_name as string | undefined) ?? undefined

    // Notificación in-app al CV (Realtime → /offers)
    await supabase.from("notifications").insert({
      user_id: property.user_id,
      type: "offer_updated",
      payload: { offer_id: ownerOffer.id, property_id, status: newStatus, amount: ownerOffer.amount },
    })
  }

  // 4. Email al propietario
  if (ownerEmail) {
    const html =
      action === "accept"
        ? offerCvBuyerAcceptedHtml({ ownerName, propertyAddress: address, amount: ownerOffer.amount })
        : offerCvBuyerRejectedHtml({ ownerName, propertyAddress: address })
    const subject =
      action === "accept"
        ? "El comprador ha aceptado tu contraoferta"
        : "El comprador ha rechazado tu contraoferta"
    await sendEmail({ to: ownerEmail, subject, html })
  }

  // 5. Aviso interno al equipo
  const eventLabel =
    action === "accept" ? "Contraoferta aceptada por el comprador" : "Contraoferta rechazada por el comprador"
  await sendEmail({
    to: TEAM_EMAIL,
    subject: `[Ofertas] ${eventLabel} — ${address}`,
    html: teamOfferAlertHtml({
      eventLabel,
      propertyAddress: address,
      amount: ownerOffer.amount,
      buyerName: ownerOffer.buyer_name,
      buyerPhone: ownerOffer.buyer_phone,
      buyerEmail: ownerOffer.buyer_email,
      buyerDni: ownerOffer.buyer_dni,
    }),
  })

  return jsonResponse({ success: true, action, amount: ownerOffer.amount }, 200)
})

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendEmail } from "../_shared/send-email.ts"
import { ownerVisitCanceledByVisitorHtml } from "../_shared/email-templates/visit-status.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Estados de una visita que el comprador puede cancelar (visita en curso).
const CANCELLABLE = ["Pending to confirm", "Confirmed"]

interface CancelBody {
  wa_phone_number: string
  property_id?: string
  slot_id?: string
}

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
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  // Auth — invocada internamente por whatsapp-agent con x-api-key
  const apiKey = req.headers.get("x-api-key")
  if (!apiKey || apiKey !== HEROHOME_API_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: CancelBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const { wa_phone_number, property_id, slot_id } = body

  if (!wa_phone_number) {
    return jsonResponse({ error: "wa_phone_number is required" }, 400)
  }
  if (property_id && !UUID_REGEX.test(property_id)) {
    return jsonResponse({ error: "Invalid property_id format" }, 400)
  }
  if (slot_id && !UUID_REGEX.test(slot_id)) {
    return jsonResponse({ error: "Invalid slot_id format" }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const nowISO = new Date().toISOString()

  // Visitas futuras cancelables del comprador (solo las suyas, por teléfono).
  let query = supabase
    .from("visit_slots")
    .select("id, property_id, status, start_time, end_time, visitor_name, visitor_last_name")
    .eq("visitor_phone", wa_phone_number)
    .in("status", CANCELLABLE)
    .gt("start_time", nowISO)
    .order("start_time", { ascending: true })

  if (property_id) query = query.eq("property_id", property_id)

  const { data: visits, error: visitsError } = await query

  if (visitsError) {
    return jsonResponse({ error: visitsError.message }, 500)
  }

  if (!visits || visits.length === 0) {
    return jsonResponse(
      { success: false, no_visits: true, message: "No consta ninguna visita activa a tu nombre para cancelar." },
      200
    )
  }

  // Determinar qué visita cancelar
  type Visit = (typeof visits)[number]
  let target: Visit | null = null

  if (slot_id) {
    target = visits.find((v) => v.id === slot_id) ?? null
    if (!target) {
      return jsonResponse(
        {
          success: false,
          error: "El horario indicado no corresponde a una visita activa tuya.",
          visits: visits.map((v) => ({ slot_id: v.id, start_time: v.start_time, display: formatMadrid(v.start_time) })),
        },
        200
      )
    }
  } else if (visits.length === 1) {
    target = visits[0]
  } else {
    // Varias visitas y sin slot_id → el agente debe preguntar cuál
    return jsonResponse(
      {
        success: false,
        needs_selection: true,
        message: "El comprador tiene varias visitas; pregúntale cuál quiere cancelar y vuelve a llamar con el slot_id.",
        visits: visits.map((v) => ({ slot_id: v.id, start_time: v.start_time, display: formatMadrid(v.start_time) })),
      },
      200
    )
  }

  // Cancelación atómica — guardada por teléfono y estado aún cancelable (anti-carrera)
  const { data: updated, error: updateError } = await supabase
    .from("visit_slots")
    .update({ status: "Canceled by visitor", updated_at: nowISO })
    .eq("id", target.id)
    .eq("visitor_phone", wa_phone_number)
    .in("status", CANCELLABLE)
    .select("id, property_id, start_time, end_time")

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500)
  }

  if (!updated || updated.length === 0) {
    return jsonResponse(
      { success: false, error: "La visita ya no se puede cancelar (quizá ya estaba cancelada)." },
      409
    )
  }

  const cancelled = updated[0]

  // Notificar al CV (propietario): bell en la PWA (Realtime) + email si la visita
  // estaba CONFIRMADA (tenía el hueco comprometido).
  const visitorName = [target.visitor_name, target.visitor_last_name].filter(Boolean).join(" ") || "Un comprador"

  const { data: property, error: propError } = await supabase
    .from("properties")
    .select("user_id, street, city")
    .eq("id", cancelled.property_id)
    .maybeSingle()

  if (propError || !property?.user_id) {
    console.error("[cancel-visit-by-visitor] No se pudo obtener el propietario:", propError?.message)
  } else {
    // 1. Notificación in-app — la PWA la recibe por Realtime (useNotifications)
    const { error: notifError } = await supabase.from("notifications").insert({
      user_id: property.user_id,
      type: "visit_canceled",
      payload: {
        slot_id: cancelled.id,
        property_id: cancelled.property_id,
        visitor_name: visitorName,
        visitor_phone: wa_phone_number,
        start_time: cancelled.start_time,
        end_time: cancelled.end_time,
        canceled_by: "visitor",
      },
    })
    if (notifError) {
      console.error("[cancel-visit-by-visitor] Error insertando notificación:", notifError.message)
    }

    // 2. Email al propietario SOLO si la visita estaba 'Confirmed'
    if (target.status === "Confirmed") {
      const { data: owner } = await supabase
        .from("users")
        .select("email, first_name")
        .eq("id", property.user_id)
        .maybeSingle()

      if (owner?.email) {
        const address = [property.street, property.city].filter(Boolean).join(", ") || "tu vivienda"
        const emailRes = await sendEmail({
          to: owner.email,
          subject: "Un comprador ha cancelado su visita",
          html: ownerVisitCanceledByVisitorHtml({
            ownerName: owner.first_name ?? undefined,
            visitorName,
            propertyAddress: address,
            dateTime: formatMadrid(cancelled.start_time),
          }),
        })
        if (!emailRes.success) {
          console.error("[cancel-visit-by-visitor] Error enviando email al propietario:", emailRes.error)
        }
      }
    }
  }

  return jsonResponse(
    {
      success: true,
      slot_id: cancelled.id,
      property_id: cancelled.property_id,
      start_time: cancelled.start_time,
      display: formatMadrid(cancelled.start_time),
      status: "Canceled by visitor",
      message: "Visita cancelada correctamente.",
    },
    200
  )
})

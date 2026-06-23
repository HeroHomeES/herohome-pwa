import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendEmail } from "../_shared/send-email.ts"
import { sendWhatsAppTemplate } from "../_shared/send-whatsapp.ts"
import { visitReminderPcHtml, visitReminderCvHtml } from "../_shared/email-templates/visit-status.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!

const TZ = "Europe/Madrid"
const TEMPLATE_REMINDER = "recordatorio_visita" // plantilla Meta (es_ES), 3 vars: nombre, dirección, fecha/hora

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Fecha local de Madrid (YYYY-MM-DD) de un instante UTC.
function madridDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

// "lunes, 22 de junio a las 11:00" en hora de Madrid.
function formatMadrid(iso: string): string {
  const d = new Date(iso)
  const fecha = new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d)
  const hora = new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)
  return `${fecha} a las ${hora}`
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  // Auth — invocada por el cron (pg_cron) con x-api-key.
  const apiKey = req.headers.get("x-api-key")
  if (!apiKey || apiKey !== HEROHOME_API_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date()

  // Recordatorio "el día antes": visitas cuya fecha local (Madrid) es la de MAÑANA.
  const tomorrowMadrid = madridDate(new Date(now.getTime() + 24 * 3_600_000).toISOString())

  // Candidatas: visitas Confirmed en las próximas ~48h; luego filtramos a las de mañana.
  const { data: visits, error } = await supabase
    .from("visit_slots")
    .select("id, property_id, start_time, visitor_name, visitor_last_name, visitor_phone, visitor_email")
    .eq("status", "Confirmed")
    .gte("start_time", now.toISOString())
    .lt("start_time", new Date(now.getTime() + 48 * 3_600_000).toISOString())
    .order("start_time", { ascending: true })

  if (error) {
    return jsonResponse({ error: error.message }, 500)
  }

  const tomorrowVisits = (visits ?? []).filter((v) => madridDate(v.start_time) === tomorrowMadrid)

  let remindersPc = 0
  let remindersCv = 0

  for (const v of tomorrowVisits) {
    const { data: property } = await supabase
      .from("properties")
      .select("street, city, user_id")
      .eq("id", v.property_id)
      .maybeSingle()

    const address = [property?.street, property?.city].filter(Boolean).join(", ") || "la vivienda"
    const dateTime = formatMadrid(v.start_time)
    const firstName = v.visitor_name || "Hola"
    const fullName = [v.visitor_name, v.visitor_last_name].filter(Boolean).join(" ") || "Un comprador"

    // ── Recordatorio al COMPRADOR (PC): WhatsApp (plantilla) + email ──
    if (v.visitor_phone) {
      const wa = await sendWhatsAppTemplate({
        to: v.visitor_phone,
        templateName: TEMPLATE_REMINDER,
        bodyParams: [firstName, address, dateTime],
      })
      if (!wa.success) {
        console.error(`[visit-reminders] WhatsApp recordatorio falló para ${v.visitor_phone}: ${wa.error}`)
      }
    }
    if (v.visitor_email) {
      const em = await sendEmail({
        to: v.visitor_email,
        subject: "Recordatorio de tu visita de mañana",
        html: visitReminderPcHtml({ visitorName: firstName, propertyAddress: address, dateTime }),
      })
      if (!em.success) console.error(`[visit-reminders] Email PC falló: ${em.error}`)
    }
    remindersPc++

    // ── Recordatorio al PROPIETARIO (CV): email ──
    if (property?.user_id) {
      const { data: owner } = await supabase
        .from("users")
        .select("email, first_name")
        .eq("id", property.user_id)
        .maybeSingle()

      if (owner?.email) {
        const em = await sendEmail({
          to: owner.email,
          subject: "Recordatorio: visita mañana en tu vivienda",
          html: visitReminderCvHtml({
            ownerName: owner.first_name ?? undefined,
            visitorName: fullName,
            propertyAddress: address,
            dateTime,
          }),
        })
        if (!em.success) console.error(`[visit-reminders] Email CV falló: ${em.error}`)
        else remindersCv++
      }
    }
  }

  return jsonResponse(
    {
      success: true,
      tomorrow_madrid: tomorrowMadrid,
      visits_found: tomorrowVisits.length,
      reminders_pc: remindersPc,
      reminders_cv: remindersCv,
    },
    200
  )
})

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0"
import { sendEmail } from "../_shared/send-email.ts"
import { sendWhatsAppTemplate } from "../_shared/send-whatsapp.ts"
import { visitReminderPcHtml, visitReminderCvHtml } from "../_shared/email-templates/visit-status.ts"
import { alertTeam } from "../_shared/alert.ts"
import { pingHealthcheck } from "../_shared/healthcheck.ts"

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

async function handle(req: Request): Promise<Response> {
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
    await alertTeam({
      source: "visit-reminders",
      subject: "Fallo al consultar las visitas Confirmed",
      detail: error.message,
    })
    return jsonResponse({ error: error.message }, 500)
  }

  const tomorrowVisits = (visits ?? []).filter((v) => madridDate(v.start_time) === tomorrowMadrid)

  let remindersPc = 0
  let remindersCv = 0
  const sendFailures: string[] = []

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
      // Orden de la plantilla recordatorio_visita: {{1}}=nombre, {{2}}=fecha, {{3}}=dirección
      const wa = await sendWhatsAppTemplate({
        to: v.visitor_phone,
        templateName: TEMPLATE_REMINDER,
        bodyParams: [firstName, dateTime, address],
      })
      if (!wa.success) {
        console.error(`[visit-reminders] WhatsApp recordatorio falló para ${v.visitor_phone}: ${wa.error}`)
        sendFailures.push(`WhatsApp PC ${v.visitor_phone} (visita ${v.id}): ${wa.error}`)
      }
    }
    if (v.visitor_email) {
      const em = await sendEmail({
        to: v.visitor_email,
        subject: "Recordatorio de tu visita de mañana",
        html: visitReminderPcHtml({ visitorName: firstName, propertyAddress: address, dateTime }),
      })
      if (!em.success) {
        console.error(`[visit-reminders] Email PC falló: ${em.error}`)
        sendFailures.push(`Email PC ${v.visitor_email} (visita ${v.id}): ${em.error}`)
      }
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
        if (!em.success) {
          console.error(`[visit-reminders] Email CV falló: ${em.error}`)
          sendFailures.push(`Email CV ${owner.email} (visita ${v.id}): ${em.error}`)
        } else remindersCv++
      }
    }
  }

  if (sendFailures.length > 0) {
    await alertTeam({
      source: "visit-reminders",
      subject: `${sendFailures.length} envío(s) de recordatorio fallaron`,
      detail: sendFailures.join("\n"),
    })
  }

  return jsonResponse(
    {
      success: true,
      tomorrow_madrid: tomorrowMadrid,
      visits_found: tomorrowVisits.length,
      reminders_pc: remindersPc,
      reminders_cv: remindersCv,
      send_failures: sendFailures.length,
    },
    200
  )
}

Deno.serve(async (req: Request): Promise<Response> => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  try {
    const res = await handle(req)
    // Dead-man's-switch: solo señales de ejecuciones reales del cron
    // (POST autenticado), nunca de OPTIONS ni de probes sin auth (401).
    if (req.method === "POST" && res.status === 200) {
      await pingHealthcheck(supabase, "healthcheck_visit_reminders")
    } else if (req.method === "POST" && res.status === 500) {
      await pingHealthcheck(supabase, "healthcheck_visit_reminders", false)
    }
    return res
  } catch (e) {
    const detail = e instanceof Error ? (e.stack ?? e.message) : String(e)
    await alertTeam({ source: "visit-reminders", subject: "Excepción no controlada en el cron", detail })
    await pingHealthcheck(supabase, "healthcheck_visit_reminders", false)
    return jsonResponse({ error: "internal error" }, 500)
  }
})

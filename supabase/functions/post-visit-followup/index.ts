import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendWhatsAppTemplate } from "../_shared/send-whatsapp.ts"
import { alertTeam } from "../_shared/alert.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!

// Plantilla Meta (es_ES, sin botones): {{1}} nombre, {{2}} dirección.
const TEMPLATE_POSTVISIT = "post_visita"

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

// Texto equivalente al de la plantilla, para dejarlo en el historial de la
// conversación y que Hero tenga contexto cuando el comprador responda.
function postVisitText(firstName: string, address: string): string {
  return `Hola ${firstName} 👋 ¿Qué te ha parecido la visita a ${address}? Si quieres hacer una oferta o tienes cualquier duda, escríbeme por aquí y te ayudo.`
}

// Cron (cada 30 min): envía un mensaje post-visita ~1h después de cada visita
// para invitar a ofertar o recoger feedback. Idempotente vía post_visit_sent_at.
async function handle(req: Request): Promise<Response> {
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date()
  const endedBefore = new Date(now.getTime() - 60 * 60 * 1000).toISOString() // hace ≥1h
  const endedAfter = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString() // ventana de 12h (no retroactivo)

  // Visitas que terminaron hace 1–12h y aún no tienen follow-up. Incluimos
  // 'Completed' además de 'Confirmed': el cron complete-visits (23:00) puede
  // marcar Completed una visita de la tarde-noche antes de que dispare este
  // follow-up de ~1h. La ventana de 12h + post_visit_sent_at evitan duplicados.
  const { data: visits, error } = await supabase
    .from("visit_slots")
    .select("id, property_id, visitor_name, visitor_phone")
    .in("status", ["Confirmed", "Completed"])
    .lt("end_time", endedBefore)
    .gt("end_time", endedAfter)
    .is("post_visit_sent_at", null)

  if (error) {
    await alertTeam({
      source: "post-visit-followup",
      subject: "Fallo al consultar las visitas para el follow-up",
      detail: error.message,
    })
    return jsonResponse({ error: error.message }, 500)
  }

  let sent = 0
  const sendFailures: string[] = []

  for (const v of visits ?? []) {
    if (!v.visitor_phone) continue

    const { data: property } = await supabase
      .from("properties")
      .select("street, city")
      .eq("id", v.property_id)
      .maybeSingle()

    const address = [property?.street, property?.city].filter(Boolean).join(", ") || "la vivienda"
    const firstName = v.visitor_name || "Hola"

    const wa = await sendWhatsAppTemplate({
      to: v.visitor_phone,
      templateName: TEMPLATE_POSTVISIT,
      bodyParams: [firstName, address],
    })

    if (!wa.success) {
      // No marcamos el flag: se reintenta en la siguiente pasada del cron.
      console.error(`[post-visit-followup] WhatsApp falló para ${v.visitor_phone}: ${wa.error}`)
      sendFailures.push(`WhatsApp ${v.visitor_phone} (visita ${v.id}): ${wa.error}`)
      continue
    }

    // Marca de idempotencia
    await supabase
      .from("visit_slots")
      .update({ post_visit_sent_at: now.toISOString() })
      .eq("id", v.id)

    // Persiste el mensaje en el historial de la conversación (contexto para Hero)
    const { data: conv } = await supabase
      .from("whatsapp_conversations")
      .select("id, messages")
      .eq("wa_phone_number", v.visitor_phone)
      .eq("property_id", v.property_id)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (conv) {
      const msgs = Array.isArray(conv.messages) ? conv.messages : []
      await supabase
        .from("whatsapp_conversations")
        .update({
          messages: [...msgs, { role: "assistant", content: postVisitText(firstName, address), ts: now.toISOString() }],
          last_message_at: now.toISOString(),
        })
        .eq("id", conv.id)
    }

    sent++
  }

  if (sendFailures.length > 0) {
    await alertTeam({
      source: "post-visit-followup",
      subject: `${sendFailures.length} envío(s) post-visita fallaron`,
      detail: sendFailures.join("\n"),
    })
  }

  return jsonResponse(
    { success: true, candidates: visits?.length ?? 0, sent, send_failures: sendFailures.length },
    200
  )
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handle(req)
  } catch (e) {
    const detail = e instanceof Error ? (e.stack ?? e.message) : String(e)
    await alertTeam({ source: "post-visit-followup", subject: "Excepción no controlada en el cron", detail })
    return jsonResponse({ error: "internal error" }, 500)
  }
})

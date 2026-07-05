import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface FeedbackBody {
  property_id: string
  wa_phone_number: string
  outcome: "interested" | "not_interested"
  feedback?: string
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Tool de whatsapp-agent: guarda el feedback del comprador tras su visita en la
// propia visita (post_visit_outcome + post_visit_feedback, texto literal/raw).
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

  let body: FeedbackBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const { property_id, wa_phone_number, outcome, feedback } = body
  if (!property_id || !wa_phone_number || (outcome !== "interested" && outcome !== "not_interested")) {
    return jsonResponse(
      { error: "property_id, wa_phone_number y outcome (interested|not_interested) son obligatorios" },
      400
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Visita más reciente del comprador en esta vivienda (la que acaba de hacer).
  const { data: visit } = await supabase
    .from("visit_slots")
    .select("id")
    .eq("property_id", property_id)
    .eq("visitor_phone", wa_phone_number)
    .in("status", ["Confirmed", "Completed"])
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!visit) {
    return jsonResponse({ success: false, no_visit: true }, 200)
  }

  const { error: updateError } = await supabase
    .from("visit_slots")
    .update({
      post_visit_outcome: outcome,
      // Guardamos el texto literal del visitante (raw); null si no lo dio.
      post_visit_feedback: feedback && feedback.trim() ? feedback.trim() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", visit.id)

  if (updateError) {
    return jsonResponse({ error: `No se pudo guardar el feedback: ${updateError.message}` }, 500)
  }

  return jsonResponse({ success: true, outcome }, 200)
})

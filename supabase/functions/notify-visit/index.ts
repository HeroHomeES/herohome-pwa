import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!req.headers.get("Authorization")) {
    return new Response(JSON.stringify({ error: "Missing authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  let body: { visit_slot_id: string; action: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { visit_slot_id, action } = body

  if (!visit_slot_id || !action) {
    return new Response(JSON.stringify({ error: "visit_slot_id y action son obligatorios" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // 1. Obtener datos de la visita
  const { data: slot, error: slotError } = await supabase
    .from("visit_slots")
    .select("*")
    .eq("id", visit_slot_id)
    .single()

  if (slotError || !slot) {
    return new Response(JSON.stringify({ error: `Visita no encontrada: ${slotError?.message}` }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // 2. Obtener datos de la propiedad
  const { data: property } = await supabase
    .from("properties")
    .select("street, city, state, user_id")
    .eq("id", slot.property_id)
    .single()

  // 3. Obtener datos del CV (vendedor)
  const { data: seller } = property?.user_id
    ? await supabase
        .from("users")
        .select("first_name, last_name, email, phone")
        .eq("id", property.user_id)
        .single()
    : { data: null }

  // 4. Llamar al webhook de Make
  const webhookUrl = Deno.env.get("MAKE_WEBHOOK_NOTIFY_VISIT")
  if (!webhookUrl) {
    console.warn("[notify-visit] MAKE_WEBHOOK_NOTIFY_VISIT no configurada")
    return new Response(JSON.stringify({ success: false, error: "Webhook no configurado" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const payload = {
    action,
    visit: {
      id: slot.id,
      start_time: slot.start_time,
      end_time: slot.end_time,
      visitor_name: [slot.visitor_name, slot.visitor_last_name].filter(Boolean).join(" ") || "Visitante",
      visitor_phone: slot.visitor_phone ?? null,
      visitor_email: slot.visitor_email ?? null,
    },
    property: {
      address: [property?.street, property?.city, property?.state].filter(Boolean).join(", "),
    },
    seller: {
      name: [seller?.first_name, seller?.last_name].filter(Boolean).join(" "),
      email: seller?.email ?? null,
      phone: seller?.phone ?? null,
    },
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      console.error(`[notify-visit] Make respondió ${res.status}`)
      return new Response(JSON.stringify({ success: false, error: `Make error: ${res.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[notify-visit] Error llamando a Make:", message)
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})

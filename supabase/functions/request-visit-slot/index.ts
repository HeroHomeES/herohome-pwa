import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RequestVisitBody {
  slot_id: string
  visitor_name: string
  visitor_last_name: string
  visitor_phone: string
  visitor_email: string
  visitor_dni?: string
  consent_given: boolean
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Auth
  const apiKey = req.headers.get("x-api-key")
  if (!apiKey || apiKey !== HEROHOME_API_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Parse body
  let body: RequestVisitBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { slot_id, visitor_name, visitor_last_name, visitor_phone, visitor_email, visitor_dni, consent_given } = body

  // Validate required fields presence
  if (!slot_id || !visitor_name || !visitor_last_name || !visitor_phone || !visitor_email || consent_given === undefined || consent_given === null) {
    return new Response(
      JSON.stringify({
        error: "slot_id, visitor_name, visitor_last_name, visitor_phone, visitor_email y consent_given son obligatorios",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  if (!UUID_REGEX.test(slot_id)) {
    return new Response(JSON.stringify({ error: "Invalid slot_id format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // RGPD consent is mandatory
  if (consent_given !== true) {
    return new Response(
      JSON.stringify({
        error: "El visitante debe dar su consentimiento RGPD antes de solicitar una visita",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Fetch slot
  const { data: slot, error: slotError } = await supabase
    .from("visit_slots")
    .select("id, property_id, status, start_time, end_time")
    .eq("id", slot_id)
    .maybeSingle()

  if (slotError) {
    return new Response(JSON.stringify({ error: slotError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!slot) {
    return new Response(JSON.stringify({ error: "Slot not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (slot.status !== "Available") {
    return new Response(
      JSON.stringify({ error: "Slot is not available", current_status: slot.status }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  if (new Date(slot.start_time) < new Date()) {
    return new Response(JSON.stringify({ error: "Slot has already passed" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Atomic UPDATE — the AND status = 'Available' prevents race conditions
  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from("visit_slots")
    .update({
      status: "Pending to confirm",
      visitor_name,
      visitor_last_name,
      visitor_phone,
      visitor_email: visitor_email ?? null,
      visitor_dni: visitor_dni ?? null,
      consent_given: true,
      consent_at: now,
      updated_at: now,
    })
    .eq("id", slot_id)
    .eq("status", "Available")
    .select("id")

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!updated || updated.length === 0) {
    return new Response(
      JSON.stringify({ error: "Slot is not available", current_status: "already taken" }),
      { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  // Get property owner for the notification
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("user_id")
    .eq("id", slot.property_id)
    .maybeSingle()

  if (propertyError || !property) {
    console.error("[request-visit-slot] Error obteniendo propietario:", propertyError?.message)
  } else {
    const { error: notifError } = await supabase.from("notifications").insert({
      user_id: property.user_id,
      type: "new_visit_request",
      payload: {
        slot_id,
        property_id: slot.property_id,
        visitor_name: `${visitor_name} ${visitor_last_name}`,
        visitor_phone,
        start_time: slot.start_time,
        end_time: slot.end_time,
      },
    })

    if (notifError) {
      console.error("[request-visit-slot] Error insertando notificación:", notifError.message)
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      slot_id,
      status: "Pending to confirm",
      message: "Visita solicitada correctamente. El propietario recibirá una notificación para confirmarla.",
    }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!

const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Acción del propietario sobre una visita. Estados de origen válidos por acción.
const CONFIRMABLE = ["Pending to confirm"]
const CANCELLABLE = ["Pending to confirm", "Confirmed"]

interface ManageVisitBody {
  visit_slot_id?: string
  action?: "confirm" | "cancel"
  // Solo en modo interno (Hero): la vivienda ya verificada por el llamante.
  property_id?: string
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Decodifica el sub (user_id) del JWT ya verificado por el gateway (verify_jwt=true).
function getUserIdFromJWT(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    if (payload.role === "service_role") return null
    return payload.sub ?? null
  } catch {
    return null
  }
}

// Reutiliza notify-visit (Resend + WhatsApp al PC). notify-visit es interna:
// exige x-api-key; el anon Bearer solo satisface al gateway (verify_jwt=true).
async function notifyVisit(visitSlotId: string, action: string): Promise<void> {
  try {
    await fetch(`${FUNCTIONS_BASE_URL}/notify-visit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "x-api-key": HEROHOME_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ visit_slot_id: visitSlotId, action }),
    })
  } catch (err) {
    console.error("[manage-visit] notify-visit falló:", err)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  // --- Auth dual: x-api-key (Hero, interno) o JWT del CV (PWA) ---
  const apiKey = req.headers.get("x-api-key")
  const internal = !!apiKey && apiKey === HEROHOME_API_KEY
  let ownerUserId: string | null = null
  if (!internal) {
    const auth = req.headers.get("Authorization") ?? ""
    ownerUserId = getUserIdFromJWT(auth.replace("Bearer ", ""))
    if (!ownerUserId) return jsonResponse({ error: "No autorizado" }, 401)
  }

  let body: ManageVisitBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const { visit_slot_id, action, property_id } = body
  if (!visit_slot_id || !UUID_REGEX.test(visit_slot_id)) {
    return jsonResponse({ error: "visit_slot_id válido es obligatorio" }, 400)
  }
  if (action !== "confirm" && action !== "cancel") {
    return jsonResponse({ error: "action debe ser 'confirm' o 'cancel'" }, 400)
  }
  if (internal && (!property_id || !UUID_REGEX.test(property_id))) {
    return jsonResponse({ error: "property_id válido es obligatorio en modo interno" }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: slot, error: slotError } = await supabase
    .from("visit_slots")
    .select("id, property_id, status, start_time")
    .eq("id", visit_slot_id)
    .maybeSingle()
  if (slotError) return jsonResponse({ error: slotError.message }, 500)
  if (!slot) return jsonResponse({ error: "Visita no encontrada" }, 404)

  // --- Verificación de propiedad (aislamiento) ---
  if (internal) {
    if (slot.property_id !== property_id) return jsonResponse({ error: "Forbidden" }, 403)
  } else {
    const { data: prop } = await supabase
      .from("properties").select("user_id").eq("id", slot.property_id).maybeSingle()
    if (!prop || prop.user_id !== ownerUserId) return jsonResponse({ error: "Forbidden" }, 403)
  }

  const nowISO = new Date().toISOString()

  if (action === "confirm") {
    const { data: updated, error } = await supabase
      .from("visit_slots")
      .update({ status: "Confirmed", updated_at: nowISO })
      .eq("id", slot.id).in("status", CONFIRMABLE)
      .select("id, start_time")
    if (error) return jsonResponse({ error: error.message }, 500)
    if (!updated || updated.length === 0) {
      return jsonResponse({ success: false, error: "La visita no estaba pendiente de confirmar." }, 409)
    }
    await notifyVisit(slot.id, "Confirmed")
    return jsonResponse({ success: true, status: "Confirmed", start_time: updated[0].start_time }, 200)
  }

  // action === "cancel"
  const { data: updated, error } = await supabase
    .from("visit_slots")
    .update({ status: "Canceled by owner", updated_at: nowISO })
    .eq("id", slot.id).in("status", CANCELLABLE)
    .select("id, start_time")
  if (error) return jsonResponse({ error: error.message }, 500)
  if (!updated || updated.length === 0) {
    return jsonResponse({ success: false, error: "La visita ya no se puede cancelar (quizá ya estaba cancelada)." }, 409)
  }
  await notifyVisit(slot.id, "Canceled by owner")
  return jsonResponse({ success: true, status: "Canceled by owner", start_time: updated[0].start_time }, 200)
})

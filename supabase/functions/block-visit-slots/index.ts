import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!

const TZ = "Europe/Madrid"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/

interface BlockBody {
  property_id?: string
  from_date?: string
  to_date?: string
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Offset UTC (horas enteras) de Madrid en un instante dado (+1/+2). Igual que generate-slots.
function getMadridOffsetHours(utcDate: Date): number {
  const raw = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(utcDate)
  const madridHour = parseInt(raw) === 24 ? 0 : parseInt(raw)
  let offset = madridHour - utcDate.getUTCHours()
  if (offset > 12) offset -= 24
  if (offset < -12) offset += 24
  return offset
}

// Hora local de Madrid → instante UTC (referencia mediodía para DST).
function madridLocalToUTC(year: number, month: number, day: number, localHour: number): Date {
  const noonRef = new Date(Date.UTC(year, month - 1, day, 12))
  const offset = getMadridOffsetHours(noonRef)
  return new Date(Date.UTC(year, month - 1, day, localHour - offset, 0, 0))
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders })
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405)

  // Auth — invocada internamente por chat-with-hero con x-api-key.
  const apiKey = req.headers.get("x-api-key")
  if (!apiKey || apiKey !== HEROHOME_API_KEY) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: BlockBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const { property_id, from_date, to_date } = body
  if (!property_id || !UUID_REGEX.test(property_id)) {
    return jsonResponse({ error: "property_id válido es obligatorio" }, 400)
  }
  const fromMatch = DATE_REGEX.exec(from_date ?? "")
  const toMatch = DATE_REGEX.exec(to_date ?? "")
  if (!fromMatch || !toMatch) {
    return jsonResponse({ error: "from_date y to_date deben tener formato YYYY-MM-DD" }, 400)
  }

  const fromUTC = madridLocalToUTC(Number(fromMatch[1]), Number(fromMatch[2]), Number(fromMatch[3]), 0)
  // Medianoche (Madrid) del día siguiente al último: incluye todo to_date.
  const toEndUTC = madridLocalToUTC(Number(toMatch[1]), Number(toMatch[2]), Number(toMatch[3]) + 1, 0)
  if (toEndUTC.getTime() <= fromUTC.getTime()) {
    return jsonResponse({ error: "to_date no puede ser anterior a from_date" }, 400)
  }

  // No tocar huecos pasados.
  const nowISO = new Date().toISOString()
  const startISO = fromUTC.toISOString() > nowISO ? fromUTC.toISOString() : nowISO

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Solo Available → Not available, scoped a la vivienda (verificada por el llamante).
  const { data, error } = await supabase
    .from("visit_slots")
    .update({ status: "Not available", updated_at: nowISO })
    .eq("property_id", property_id)
    .eq("status", "Available")
    .gte("start_time", startISO)
    .lt("start_time", toEndUTC.toISOString())
    .select("id")
  if (error) return jsonResponse({ error: error.message }, 500)

  return jsonResponse({ success: true, blocked: data?.length ?? 0 }, 200)
})

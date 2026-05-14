import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!
const TZ = "Europe/Madrid"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]

// Returns the UTC offset in whole hours for Europe/Madrid at a given UTC instant.
function getMadridOffsetHours(utcDate: Date): number {
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
  }).format(utcDate)
  const madridHour = parseInt(raw) === 24 ? 0 : parseInt(raw)
  let offset = madridHour - utcDate.getUTCHours()
  if (offset > 12) offset -= 24
  if (offset < -12) offset += 24
  return offset
}

// Converts a UTC ISO string to a Madrid-local ISO string like "2026-05-20T16:00:00+02:00".
function toMadridISO(utcISO: string): string {
  const d = new Date(utcISO)
  const offsetH = getMadridOffsetHours(d)
  const sign = offsetH >= 0 ? "+" : "-"
  const absH = Math.abs(offsetH)
  const localMs = d.getTime() + offsetH * 3_600_000
  const l = new Date(localMs)
  const p = (n: number) => String(n).padStart(2, "0")
  return (
    `${l.getUTCFullYear()}-${p(l.getUTCMonth() + 1)}-${p(l.getUTCDate())}T` +
    `${p(l.getUTCHours())}:${p(l.getUTCMinutes())}:${p(l.getUTCSeconds())}` +
    `${sign}${p(absH)}:00`
  )
}

function getMadridDate(utcISO: string): string {
  return toMadridISO(utcISO).substring(0, 10)
}

function getMadridHHMM(utcISO: string): string {
  return toMadridISO(utcISO).substring(11, 16)
}

function getDayOfWeekEs(utcISO: string): string {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(new Date(utcISO))
  return DAYS_ES[WEEKDAYS_SHORT.indexOf(short)] ?? short
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "GET") {
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

  // Query params
  const url = new URL(req.url)
  const propertyId = url.searchParams.get("property_id")
  const daysAheadParam = url.searchParams.get("days_ahead")
  const daysAhead = daysAheadParam ? Math.max(1, parseInt(daysAheadParam, 10) || 14) : 14

  if (!propertyId) {
    return new Response(JSON.stringify({ error: "property_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!UUID_REGEX.test(propertyId)) {
    return new Response(JSON.stringify({ error: "Invalid property_id format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Verify property exists
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle()

  if (propertyError) {
    return new Response(JSON.stringify({ error: propertyError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!property) {
    return new Response(JSON.stringify({ error: "Property not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const now = new Date()
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 3_600_000)

  const { data: slots, error: slotsError } = await supabase
    .from("visit_slots")
    .select("id, start_time, end_time")
    .eq("property_id", propertyId)
    .eq("status", "Available")
    .gt("start_time", now.toISOString())
    .lt("start_time", cutoff.toISOString())
    .order("start_time", { ascending: true })

  if (slotsError) {
    return new Response(JSON.stringify({ error: slotsError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Group by Madrid local date
  type TimeEntry = { slot_id: string; start_time: string; end_time: string; display: string }
  type DayGroup = { day_of_week: string; times: TimeEntry[] }
  const byDate = new Map<string, DayGroup>()

  for (const slot of slots ?? []) {
    const date = getMadridDate(slot.start_time)
    if (!byDate.has(date)) {
      byDate.set(date, { day_of_week: getDayOfWeekEs(slot.start_time), times: [] })
    }
    byDate.get(date)!.times.push({
      slot_id: slot.id,
      start_time: toMadridISO(slot.start_time),
      end_time: toMadridISO(slot.end_time),
      display: `${getMadridHHMM(slot.start_time)} - ${getMadridHHMM(slot.end_time)}`,
    })
  }

  const groupedSlots = Array.from(byDate.entries()).map(([date, data]) => ({
    date,
    day_of_week: data.day_of_week,
    times: data.times,
  }))

  return new Response(
    JSON.stringify({
      property_id: propertyId,
      slots: groupedSlots,
      total_slots: slots?.length ?? 0,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TZ = "Europe/Madrid"
const DAYS_AHEAD = 28

interface AvailabilityEntry {
  day_of_week: number // 0=Lunes, 6=Domingo
  from_hour: number
  to_hour: number
  is_active: boolean
}

interface SlotInsert {
  property_id: string
  start_time: string
  end_time: string
  status: "available"
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Returns the UTC offset in hours for Europe/Madrid at a given UTC instant (+1 CET, +2 CEST)
function getMadridOffsetHours(utcDate: Date): number {
  const madridHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      hour12: false,
    }).format(utcDate)
  )
  const utcHour = utcDate.getUTCHours()
  let offset = madridHour - utcHour
  if (offset > 12) offset -= 24
  if (offset < -12) offset += 24
  return offset
}

// Extracts calendar date + current hour (Madrid local) from a UTC instant
function getMadridParts(utcDate: Date): {
  year: number
  month: number
  day: number
  hour: number
  dayOfWeekMon0: number
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  })
  const parts = Object.fromEntries(fmt.formatToParts(utcDate).map((p) => [p.type, p.value]))

  // en-US weekday 'short': Sun Mon Tue Wed Thu Fri Sat
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const jsDay = weekdays.indexOf(parts.weekday) // 0=Sun
  const dayOfWeekMon0 = (jsDay + 6) % 7 // 0=Mon … 6=Sun

  const rawHour = parseInt(parts.hour)
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    hour: rawHour === 24 ? 0 : rawHour,
    dayOfWeekMon0,
  }
}

// Converts a Madrid local calendar date + hour to a UTC Date.
// Uses noon of that day as the DST reference — safe for business hours (never at 02:00).
function madridLocalToUTC(year: number, month: number, day: number, localHour: number): Date {
  const noonRef = new Date(Date.UTC(year, month - 1, day, 12))
  const offset = getMadridOffsetHours(noonRef)
  return new Date(Date.UTC(year, month - 1, day, localHour - offset, 0, 0))
}

// Decodes a JWT payload without verifying the signature (gateway already verified it).
// Returns null for service_role tokens (which have no user sub).
function getUserIdFromJWT(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    if (payload.role === "service_role") return null
    return payload.sub ?? null
  } catch {
    return null
  }
}

// Deletes future 'available' slots and generates new ones for the next DAYS_AHEAD days.
async function processProperty(
  supabase: ReturnType<typeof createClient>,
  propertyId: string,
  config: AvailabilityEntry[],
  nowUTC: Date
): Promise<{ slotsCreated: number; slotsDeleted: number }> {
  const nowISO = nowUTC.toISOString()

  // Delete all future 'available' slots (preserves pending/confirmed/etc.)
  const { count: deletedCount, error: deleteError } = await supabase
    .from("visit_slots")
    .delete({ count: "exact" })
    .eq("property_id", propertyId)
    .eq("status", "available")
    .gte("start_time", nowISO)

  if (deleteError) throw new Error(`Error borrando slots de ${propertyId}: ${deleteError.message}`)

  const slotsDeleted = deletedCount ?? 0

  // Build a lookup: day_of_week → active entry
  const activeByDay = new Map<number, AvailabilityEntry>()
  for (const entry of config) {
    if (entry.is_active) activeByDay.set(entry.day_of_week, entry)
  }

  if (activeByDay.size === 0) {
    return { slotsCreated: 0, slotsDeleted }
  }

  const madridNow = getMadridParts(nowUTC)
  const slots: SlotInsert[] = []

  for (let i = 0; i < DAYS_AHEAD; i++) {
    // Advance i calendar days from today in Madrid by using noon UTC of that ordinal day
    const dayRef = new Date(Date.UTC(madridNow.year, madridNow.month - 1, madridNow.day + i, 12))
    const { year, month, day, dayOfWeekMon0 } = getMadridParts(dayRef)

    const entry = activeByDay.get(dayOfWeekMon0)
    if (!entry) continue

    for (let h = entry.from_hour; h < entry.to_hour; h++) {
      // Skip hours that have already started today
      if (i === 0 && h <= madridNow.hour) continue

      const startUTC = madridLocalToUTC(year, month, day, h)
      const endUTC = new Date(startUTC.getTime() + 3_600_000)

      slots.push({
        property_id: propertyId,
        start_time: startUTC.toISOString(),
        end_time: endUTC.toISOString(),
        status: "available",
      })
    }
  }

  if (slots.length > 0) {
    const { error: insertError } = await supabase.from("visit_slots").insert(slots)
    if (insertError) throw new Error(`Error insertando slots de ${propertyId}: ${insertError.message}`)
  }

  return { slotsCreated: slots.length, slotsDeleted }
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

  // Parse body — empty body = cron mode
  let propertyId: string | null = null
  try {
    const body = await req.json()
    propertyId = body?.property_id ?? null
  } catch {
    // intentional: empty or missing body triggers cron mode
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Verify property ownership when called with a user JWT (not service role)
  if (propertyId) {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "")
    const userId = getUserIdFromJWT(token)

    if (userId) {
      const { data: prop, error: propError } = await supabase
        .from("properties")
        .select("user_id")
        .eq("id", propertyId)
        .maybeSingle()

      if (propError) {
        return new Response(JSON.stringify({ error: propError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (!prop || prop.user_id !== userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }
  }

  const nowUTC = new Date()
  let totalCreated = 0
  let totalDeleted = 0
  let propertiesProcessed = 0

  try {
    if (propertyId) {
      // ── Mode 1: single property ──────────────────────────────────────────────
      const { data: configRow, error: configError } = await supabase
        .from("availability_config")
        .select("config")
        .eq("property_id", propertyId)
        .maybeSingle()

      if (configError) throw new Error(configError.message)

      if (configRow) {
        const { slotsCreated, slotsDeleted } = await processProperty(
          supabase,
          propertyId,
          configRow.config as AvailabilityEntry[],
          nowUTC
        )
        totalCreated = slotsCreated
        totalDeleted = slotsDeleted
        propertiesProcessed = 1
      }
    } else {
      // ── Mode 2: cron — all On Sale properties ────────────────────────────────
      const { data: onSaleProps, error: propsError } = await supabase
        .from("properties")
        .select("id")
        .eq("status", "On Sale")

      if (propsError) throw new Error(propsError.message)

      const onSaleIds = (onSaleProps ?? []).map((p) => p.id)

      if (onSaleIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, properties_processed: 0, slots_created: 0, slots_deleted: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      const { data: configs, error: configsError } = await supabase
        .from("availability_config")
        .select("property_id, config")
        .in("property_id", onSaleIds)

      if (configsError) throw new Error(configsError.message)

      for (const row of configs ?? []) {
        try {
          const { slotsCreated, slotsDeleted } = await processProperty(
            supabase,
            row.property_id,
            row.config as AvailabilityEntry[],
            nowUTC
          )
          totalCreated += slotsCreated
          totalDeleted += slotsDeleted
          propertiesProcessed++
        } catch (err) {
          // Log and continue — one failing property must not block the rest
          console.error(`[generate-slots] Error en property ${row.property_id}:`, err)
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[generate-slots] Error fatal:", message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  return new Response(
    JSON.stringify({
      success: true,
      properties_processed: propertiesProcessed,
      slots_created: totalCreated,
      slots_deleted: totalDeleted,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})

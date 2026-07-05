import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0"
import { alertTeam } from "../_shared/alert.ts"
import { pingHealthcheck } from "../_shared/healthcheck.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!
const TZ = "Europe/Madrid"
const DAYS_AHEAD = 14 // días hacia delante: ventana móvil de hoy + 14 días (~2 semanas)

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
  status: "Available"
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

// Sincroniza los slots de la vivienda con su disponibilidad, en una ventana móvil
// de hoy + DAYS_AHEAD días. Idempotente y seguro para ejecutar a diario:
//  - NUNCA toca slots reservados/bloqueados (status != 'Available').
//  - Borra los 'Available' futuros que ya no encajan con la config o que quedan
//    fuera de la ventana (refleja reducciones de disponibilidad y recorta sobrantes).
//  - Crea los slots de la config que falten, SOLO si esa hora no tiene ya un slot
//    de cualquier estado (evita duplicar visitas en curso → sin doble reserva).
async function processProperty(
  supabase: ReturnType<typeof createClient>,
  propertyId: string,
  config: AvailabilityEntry[],
  nowUTC: Date
): Promise<{ slotsCreated: number; slotsDeleted: number }> {
  const nowISO = nowUTC.toISOString()

  const activeByDay = new Map<number, AvailabilityEntry>()
  for (const entry of config) {
    if (entry.is_active) activeByDay.set(entry.day_of_week, entry)
  }

  // 1. Conjunto DESEADO de slots (start ISO → {start, end}) en [hoy, hoy+DAYS_AHEAD]
  const madridNow = getMadridParts(nowUTC)
  const desired = new Map<string, { start: string; end: string }>()
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const dayRef = new Date(Date.UTC(madridNow.year, madridNow.month - 1, madridNow.day + i, 12))
    const { year, month, day, dayOfWeekMon0 } = getMadridParts(dayRef)

    const entry = activeByDay.get(dayOfWeekMon0)
    if (!entry) continue

    for (let h = entry.from_hour; h < entry.to_hour; h++) {
      if (i === 0 && h <= madridNow.hour) continue // no generar horas ya pasadas hoy
      const startUTC = madridLocalToUTC(year, month, day, h)
      const startISO = startUTC.toISOString()
      const endISO = new Date(startUTC.getTime() + 3_600_000).toISOString()
      desired.set(startISO, { start: startISO, end: endISO })
    }
  }

  // 2. Slots futuros existentes (cualquier estado)
  const { data: existing, error: fetchError } = await supabase
    .from("visit_slots")
    .select("id, start_time, status")
    .eq("property_id", propertyId)
    .gte("start_time", nowISO)

  if (fetchError) throw new Error(`Error leyendo slots de ${propertyId}: ${fetchError.message}`)

  const existingStartTimes = new Set<string>()
  const staleAvailableIds: string[] = []
  for (const slot of existing ?? []) {
    const startISO = new Date(slot.start_time as string).toISOString()
    existingStartTimes.add(startISO)
    // 'Available' que ya no encaja con la config (o fuera de ventana) → borrar
    if (slot.status === "Available" && !desired.has(startISO)) {
      staleAvailableIds.push(slot.id as string)
    }
  }

  // 3. Borrar los 'Available' obsoletos / fuera de ventana (nunca reservados)
  let slotsDeleted = 0
  if (staleAvailableIds.length > 0) {
    const { count, error: deleteError } = await supabase
      .from("visit_slots")
      .delete({ count: "exact" })
      .in("id", staleAvailableIds)
    if (deleteError) throw new Error(`Error borrando slots de ${propertyId}: ${deleteError.message}`)
    slotsDeleted = count ?? staleAvailableIds.length
  }

  // 4. Crear los deseados que falten (solo si esa hora no tiene ya un slot)
  const toInsert: SlotInsert[] = []
  for (const [startISO, times] of desired) {
    if (!existingStartTimes.has(startISO)) {
      toInsert.push({
        property_id: propertyId,
        start_time: times.start,
        end_time: times.end,
        status: "Available",
      })
    }
  }

  let slotsCreated = 0
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("visit_slots").insert(toInsert)
    if (insertError) throw new Error(`Error insertando slots de ${propertyId}: ${insertError.message}`)
    slotsCreated = toInsert.length
  }

  return { slotsCreated, slotsDeleted }
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

  // Auth: el cron usa x-api-key (modo todas las viviendas); la PWA usa el JWT del
  // usuario (modo single-property, con verificación de propiedad).
  const apiKey = req.headers.get("x-api-key")
  const isCron = !!apiKey && apiKey === HEROHOME_API_KEY

  // Parse body — sin property_id = modo cron
  let propertyId: string | null = null
  try {
    const body = await req.json()
    propertyId = body?.property_id ?? null
  } catch {
    // intencional: body vacío/ausente = modo cron
  }

  // Modo cron (todas las viviendas): requiere x-api-key.
  if (!propertyId && !isCron) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Modo single-property (PWA): exige JWT de usuario válido y que sea el dueño.
  if (propertyId && !isCron) {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "")
    const userId = getUserIdFromJWT(token)

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

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

  const nowUTC = new Date()
  let totalCreated = 0
  let totalDeleted = 0
  let propertiesProcessed = 0
  const propertyFailures: string[] = []

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
        .eq("status", "On sale")

      if (propsError) throw new Error(propsError.message)

      const onSaleIds = (onSaleProps ?? []).map((p) => p.id)

      if (onSaleIds.length === 0) {
        await pingHealthcheck(supabase, "healthcheck_generate_slots")
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
          propertyFailures.push(`property ${row.property_id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[generate-slots] Error fatal:", message)
    await alertTeam({
      source: "generate-slots",
      subject: `Error fatal (${isCron ? "cron" : "PWA"})`,
      detail: err instanceof Error ? (err.stack ?? message) : message,
    })
    if (isCron) await pingHealthcheck(supabase, "healthcheck_generate_slots", false)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // En modo cron, avisar si alguna vivienda falló al generar slots (no bloquea al resto).
  if (isCron && propertyFailures.length > 0) {
    await alertTeam({
      source: "generate-slots",
      subject: `${propertyFailures.length} vivienda(s) fallaron al generar slots`,
      detail: propertyFailures.join("\n"),
    })
  }

  // Dead-man's-switch: el cron ha corrido hasta el final.
  if (isCron) await pingHealthcheck(supabase, "healthcheck_generate_slots")

  return new Response(
    JSON.stringify({
      success: true,
      properties_processed: propertiesProcessed,
      slots_created: totalCreated,
      slots_deleted: totalDeleted,
      property_failures: propertyFailures.length,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})

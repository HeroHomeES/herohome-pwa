// valuation-sequence — secuencia automática de bienvenida al lead del formulario
// de valoración de vivienda (prospecto vendedor). La dispara el WEBHOOK del
// formulario web (POST server-to-server con x-api-key). Envía 3 emails vía Resend:
//   #1 inmediato · #2 a +24 h · #3 a +72 h (programados con scheduled_at).
//
// Sin estado en BD (decisión de producto): no se guarda el lead ni se puede
// cancelar la secuencia una vez lanzada. Reply-To y bajas → hola@herohome.es.
//
// verify_jwt=false (ver config.toml): la auth es el x-api-key (HEROHOME_API_KEY).

import { sendEmail } from "../_shared/send-email.ts"
import { alertTeam } from "../_shared/alert.ts"
import {
  valuationEmail1Html,
  valuationEmail2Html,
  valuationEmail3Html,
  VALUATION_SUBJECTS,
} from "../_shared/email-templates/valuation-sequence.ts"

const HEROHOME_API_KEY = Deno.env.get("HEROHOME_API_KEY")!
const REPLY_TO = "hola@herohome.es"

const HOURS = 60 * 60 * 1000

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface ValuationLeadBody {
  email?: string
  // Nombre de pila para personalizar. Se acepta `firstName` o `name` (de este
  // último se toma la primera palabra). Opcional: sin nombre el saludo es genérico.
  firstName?: string
  name?: string
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Validación de email sencilla y estricta a la vez (suficiente para un webhook).
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function resolveFirstName(body: ValuationLeadBody): string | undefined {
  const raw = (body.firstName ?? body.name ?? "").trim()
  if (!raw) return undefined
  // Primera palabra, por si llega el nombre completo.
  return raw.split(/\s+/)[0]
}

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

  let body: ValuationLeadBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const email = (body.email ?? "").trim().toLowerCase()
  if (!email || !isValidEmail(email)) {
    return jsonResponse({ error: "A valid email is required" }, 400)
  }

  const firstName = resolveFirstName(body)

  const now = Date.now()
  const at24 = new Date(now + 24 * HOURS).toISOString()
  const at72 = new Date(now + 72 * HOURS).toISOString()

  // #1 inmediato, #2 a +24 h, #3 a +72 h.
  const results = await Promise.all([
    sendEmail({
      to: email,
      subject: VALUATION_SUBJECTS.email1,
      html: valuationEmail1Html({ firstName }),
      replyTo: REPLY_TO,
    }),
    sendEmail({
      to: email,
      subject: VALUATION_SUBJECTS.email2,
      html: valuationEmail2Html({ firstName }),
      replyTo: REPLY_TO,
      scheduledAt: at24,
    }),
    sendEmail({
      to: email,
      subject: VALUATION_SUBJECTS.email3,
      html: valuationEmail3Html({ firstName }),
      replyTo: REPLY_TO,
      scheduledAt: at72,
    }),
  ])

  const labels = ["email1 (inmediato)", "email2 (+24h)", "email3 (+72h)"]
  const failures = results
    .map((r, i) => ({ r, label: labels[i] }))
    .filter((x) => !x.r.success)

  if (failures.length > 0) {
    // Fallo en silencio hacia el equipo → alerta (best-effort, no rompe la respuesta).
    await alertTeam({
      source: "valuation-sequence",
      subject: `Fallaron ${failures.length}/3 emails de valoración para ${email}`,
      detail: failures.map((f) => `${f.label}: ${f.r.error ?? "error desconocido"}`).join("\n"),
    })
  }

  return jsonResponse(
    {
      ok: failures.length === 0,
      email,
      scheduled: {
        email1: "inmediato",
        email2: at24,
        email3: at72,
      },
      results: results.map((r, i) => ({ email: labels[i], success: r.success, id: r.id })),
    },
    200
  )
})

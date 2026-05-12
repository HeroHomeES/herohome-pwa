import { welcomeEmailHtml } from "../_shared/email-templates/welcome.ts"
import { sendEmail } from "../_shared/send-email.ts"

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

  let body: { to: string; firstName: string; magicLink: string; from?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { to, firstName, magicLink, from } = body

  if (!to || !firstName || !magicLink) {
    return new Response(
      JSON.stringify({ error: "to, firstName y magicLink son obligatorios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const html = welcomeEmailHtml({ firstName, magicLink })
  const result = await sendEmail({
    to,
    subject: "¡Bienvenido a Herohome! Accede a tu cuenta",
    html,
    from,
  })

  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})

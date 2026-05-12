import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { welcomeEmailHtml } from "../_shared/email-templates/welcome.ts"
import { sendEmail } from "../_shared/send-email.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface CreateUserAndPropertyBody {
  salesforceAccountId: string
  user: {
    email: string
    firstName: string
    lastName: string
    phone?: string
    dni?: string
    salesforceContactId?: string
  }
  property: {
    street?: string
    city?: string
    state?: string
    postalCode?: string
    housingType?: string
    rooms?: number
    bathrooms?: number
    builtArea?: number
    usefulSurfaceArea?: number
    salesPrice?: number
    status?: string
  }
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

  let body: CreateUserAndPropertyBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { salesforceAccountId, user, property } = body

  if (!salesforceAccountId || !user?.email || !user?.firstName || !user?.lastName) {
    return new Response(
      JSON.stringify({ error: "salesforceAccountId, user.email, user.firstName y user.lastName son obligatorios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 1. Crear usuario en Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: user.email,
    email_confirm: true,
  })

  if (authError) {
    return new Response(
      JSON.stringify({ error: `Error creando usuario en Auth: ${authError.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const userId = authData.user.id

  // 2. Insertar en tabla users
  const { error: userInsertError } = await supabase.from("users").insert({
    id: userId,
    email: user.email,
    first_name: user.firstName,
    last_name: user.lastName,
    phone: user.phone ?? null,
    dni: user.dni ?? null,
    salesforce_contact_id: user.salesforceContactId ?? null,
    salesforce_account_id: salesforceAccountId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  if (userInsertError) {
    return new Response(
      JSON.stringify({ error: `Error insertando usuario en tabla users: ${userInsertError.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  // 3. Insertar en tabla properties
  const { error: propertyInsertError } = await supabase.from("properties").insert({
    salesforce_account_id: salesforceAccountId,
    user_id: userId,
    street: property?.street ?? null,
    city: property?.city ?? null,
    state: property?.state ?? null,
    postal_code: property?.postalCode ?? null,
    housing_type: property?.housingType ?? null,
    rooms: property?.rooms ?? null,
    bathrooms: property?.bathrooms ?? null,
    built_area: property?.builtArea ?? null,
    useful_surface_area: property?.usefulSurfaceArea ?? null,
    sales_price: property?.salesPrice ?? null,
    status: property?.status ?? "On Sale",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  if (propertyInsertError) {
    return new Response(
      JSON.stringify({ error: `Error insertando propiedad: ${propertyInsertError.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  // 4. Generar Magic Link
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  })

  if (linkError || !linkData?.properties?.action_link) {
    return new Response(
      JSON.stringify({ error: `Error generando Magic Link: ${linkError?.message ?? "link no disponible"}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const magicLink = linkData.properties.action_link

  // 5. Enviar email de bienvenida (no bloqueante)
  const html = welcomeEmailHtml({ firstName: user.firstName, magicLink })
  const emailResult = await sendEmail({
    to: user.email,
    subject: "¡Bienvenido a Herohome! Accede a tu cuenta",
    html,
  })

  return new Response(
    JSON.stringify({
      success: true,
      user_id: userId,
      magic_link: magicLink,
      email_sent: emailResult.success,
      email_error: emailResult.error ?? null,
    }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})

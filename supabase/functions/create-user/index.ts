import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { welcomeEmailHtml } from "../_shared/email-templates/welcome.ts"
import { sendEmail } from "../_shared/send-email.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface CreateUserAndPropertyBody {
  salesforceAccountId?: string
  user: {
    email: string
    firstName?: string
    first_name?: string
    lastName?: string
    last_name?: string
    phone?: string
    dni?: string
    salesforceContactId?: string
    contactId?: string
  }
  property: {
    salesforceAccountId?: string
    street?: string
    city?: string
    state?: string
    postalCode?: string
    housingType?: string
    rooms?: number | string
    bathrooms?: number | string
    builtArea?: number
    usefulSurfaceArea?: number
    usefulSurface?: number
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

  const { user, property } = body

  console.log("[create-user] Body recibido:", JSON.stringify(body))

  // Normalizar campos con nombres alternativos
  const salesforceAccountId = body.salesforceAccountId ?? property?.salesforceAccountId
  const firstName = user?.firstName ?? user?.first_name
  const lastName = user?.lastName ?? user?.last_name
  const salesforceContactId = user?.salesforceContactId ?? user?.contactId
  const usefulSurfaceArea = property?.usefulSurfaceArea ?? property?.usefulSurface

  if (!salesforceAccountId || !user?.email || !firstName || !lastName) {
    return new Response(
      JSON.stringify({ error: "salesforceAccountId, user.email, firstName y lastName son obligatorios" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // 1. Crear usuario en Supabase Auth (o recuperar si ya existe)
  let userId: string
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: user.email,
    email_confirm: true,
  })

  if (authError) {
    if (!authError.message.includes("already been registered")) {
      return new Response(
        JSON.stringify({ error: `Error creando usuario en Auth: ${authError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    // El usuario ya existe en auth.users — recuperamos su ID
    const { data: existingUser, error: lookupError } = await supabase
      .schema("auth")
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single()

    if (lookupError || !existingUser) {
      return new Response(
        JSON.stringify({ error: `Usuario ya existe pero no se pudo recuperar: ${lookupError?.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    userId = existingUser.id
  } else {
    userId = authData.user.id
  }

  // 2. Upsert en tabla users (seguro ante reintentos y duplicados)
  const { error: userUpsertError } = await supabase.from("users").upsert({
    id: userId,
    email: user.email,
    first_name: firstName,
    last_name: lastName,
    phone: user.phone ?? null,
    dni: user.dni ?? null,
    salesforce_contact_id: salesforceContactId ?? null,
    salesforce_account_id: salesforceAccountId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" })

  if (userUpsertError) {
    return new Response(
      JSON.stringify({ error: `Error en upsert de usuario: ${userUpsertError.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  // 3. Upsert en tabla properties (seguro ante reintentos y duplicados)
  const { error: propertyUpsertError } = await supabase.from("properties").upsert({
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
    useful_surface_area: usefulSurfaceArea ?? null,
    sales_price: property?.salesPrice ?? null,
    status: property?.status ?? "On Sale",
    updated_at: new Date().toISOString(),
  }, { onConflict: "salesforce_account_id" })

  if (propertyUpsertError) {
    return new Response(
      JSON.stringify({ error: `Error en upsert de propiedad: ${propertyUpsertError.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  // 4. Generar Magic Link
  const pwaBaseUrl = Deno.env.get("PWA_BASE_URL") ?? "https://app.herohome.es"
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
    options: { redirectTo: pwaBaseUrl },
  })

  if (linkError || !linkData?.properties?.action_link) {
    return new Response(
      JSON.stringify({ error: `Error generando Magic Link: ${linkError?.message ?? "link no disponible"}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const magicLink = linkData.properties.action_link

  // 5. Enviar email de bienvenida
  const html = welcomeEmailHtml({ firstName, magicLink })
  const emailResult = await sendEmail({
    to: user.email,
    subject: "¡Bienvenido a Herohome! Accede a tu cuenta",
    html,
  })
  if (!emailResult.success) {
    console.error(`[create-user] Email no enviado a ${user.email}: ${emailResult.error}`)
  }

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

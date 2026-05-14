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

  const url = new URL(req.url)
  const waPhoneNumber = url.searchParams.get("wa_phone_number")
  const propertyId = url.searchParams.get("property_id")
  const limitParam = url.searchParams.get("limit")
  const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50)) : 50

  if (!waPhoneNumber) {
    return new Response(JSON.stringify({ error: "wa_phone_number is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (propertyId && !UUID_REGEX.test(propertyId)) {
    return new Response(JSON.stringify({ error: "Invalid property_id format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let query = supabase
    .from("whatsapp_conversations")
    .select("id, property_id, messages")
    .eq("wa_phone_number", waPhoneNumber)
    .order("last_message_at", { ascending: false })
    .limit(1)

  if (propertyId) {
    query = query.eq("property_id", propertyId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!data) {
    return new Response(
      JSON.stringify({
        conversation_id: null,
        property_id: null,
        messages: [],
        total_messages: 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  const allMessages: unknown[] = Array.isArray(data.messages) ? data.messages : []
  const totalMessages = allMessages.length
  const messages = allMessages.slice(-limit)

  return new Response(
    JSON.stringify({
      conversation_id: data.id,
      property_id: data.property_id,
      messages,
      total_messages: totalMessages,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})

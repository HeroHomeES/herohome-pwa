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

interface IncomingMessage {
  role: string
  content: string
  ts?: string
}

interface SaveMessageBody {
  wa_phone_number: string
  property_id?: string
  messages: IncomingMessage[]
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== "POST") {
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

  // Parse body
  let body: SaveMessageBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const { wa_phone_number, property_id, messages } = body

  if (!wa_phone_number) {
    return new Response(JSON.stringify({ error: "wa_phone_number is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages must be a non-empty array" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") {
      return new Response(
        JSON.stringify({ error: `Invalid role "${msg.role}": must be "user" or "assistant"` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (!msg.content || typeof msg.content !== "string" || msg.content.trim() === "") {
      return new Response(JSON.stringify({ error: "Each message must have a non-empty content string" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
  }

  if (property_id && !UUID_REGEX.test(property_id)) {
    return new Response(JSON.stringify({ error: "Invalid property_id format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Validate property exists if provided
  if (property_id) {
    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id")
      .eq("id", property_id)
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
  }

  // Stamp timestamps on messages that don't have one
  const now = new Date().toISOString()
  const stampedMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    ts: msg.ts ?? now,
  }))

  // Look for existing conversation
  let existingQuery = supabase
    .from("whatsapp_conversations")
    .select("id, messages")
    .eq("wa_phone_number", wa_phone_number)
    .order("last_message_at", { ascending: false })
    .limit(1)

  if (property_id) {
    existingQuery = existingQuery.eq("property_id", property_id)
  } else {
    existingQuery = existingQuery.is("property_id", null)
  }

  const { data: existing, error: fetchError } = await existingQuery.maybeSingle()

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (existing) {
    const currentMessages: unknown[] = Array.isArray(existing.messages) ? existing.messages : []
    const updatedMessages = [...currentMessages, ...stampedMessages]

    const { error: updateError } = await supabase
      .from("whatsapp_conversations")
      .update({ messages: updatedMessages, last_message_at: now })
      .eq("id", existing.id)

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        conversation_id: existing.id,
        action: "updated",
        total_messages: updatedMessages.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }

  // Create new conversation
  const { data: inserted, error: insertError } = await supabase
    .from("whatsapp_conversations")
    .insert({
      wa_phone_number,
      property_id: property_id ?? null,
      messages: stampedMessages,
      last_message_at: now,
    })
    .select("id")
    .single()

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  return new Response(
    JSON.stringify({
      success: true,
      conversation_id: inserted.id,
      action: "created",
      total_messages: stampedMessages.length,
    }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  )
})

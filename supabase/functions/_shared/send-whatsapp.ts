const WHATSAPP_API_VERSION = "v25.0"

function apiUrl(): string {
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!
  return `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`
}

function authHeaders(): HeadersInit {
  const token = Deno.env.get("WHATSAPP_TOKEN")!
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

export async function sendWhatsAppText(params: {
  to: string
  body: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(apiUrl(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "text",
        text: { body: params.body },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`[send-whatsapp] WhatsApp Cloud API respondió ${res.status}: ${body}`)
      return { success: false, error: `WhatsApp API error ${res.status}: ${body}` }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[send-whatsapp] Error al llamar a WhatsApp Cloud API:", message)
    return { success: false, error: message }
  }
}

export async function sendWhatsAppTemplate(params: {
  to: string
  templateName: string
  languageCode?: string
  bodyParams?: string[]
}): Promise<{ success: boolean; error?: string }> {
  try {
    const components = params.bodyParams?.length
      ? [
          {
            type: "body",
            parameters: params.bodyParams.map((text) => ({ type: "text", text })),
          },
        ]
      : undefined

    const res = await fetch(apiUrl(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.languageCode ?? "es" },
          ...(components ? { components } : {}),
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`[send-whatsapp] WhatsApp Cloud API respondió ${res.status}: ${body}`)
      return { success: false, error: `WhatsApp API error ${res.status}: ${body}` }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[send-whatsapp] Error al llamar a WhatsApp Cloud API:", message)
    return { success: false, error: message }
  }
}

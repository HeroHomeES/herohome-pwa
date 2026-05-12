const RESEND_API_URL = "https://api.resend.com/emails"
const DEFAULT_FROM = "Herohome <hola@herohome.es>"

export async function sendEmail(params: {
  to: string
  subject: string
  html: string
  from?: string
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY")

  if (!apiKey) {
    console.warn("[send-email] RESEND_API_KEY no está configurada")
    return { success: false, error: "RESEND_API_KEY not configured" }
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: params.from ?? DEFAULT_FROM,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`[send-email] Resend respondió ${res.status}: ${body}`)
      return { success: false, error: `Resend error ${res.status}: ${body}` }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[send-email] Error al llamar a Resend:", message)
    return { success: false, error: message }
  }
}

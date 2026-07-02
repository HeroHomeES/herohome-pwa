import { sendEmail } from "./send-email.ts"

// Destinatario de las alertas operativas (monitoring v1, B12).
const ALERT_TO = "hola@herohome.es"

// Envía una alerta operativa al equipo por email (Resend). BEST-EFFORT: nunca
// lanza — si la propia alerta falla (p.ej. Resend caído) se traga el error para
// no romper el flujo que la invoca. Se usa en los puntos que fallan en silencio
// (crons, fallos de envío) para no depender de mirar los logs a mano.
export async function alertTeam(params: {
  source: string // función/cron que alerta, p.ej. "visit-reminders"
  subject: string // resumen corto del problema
  detail: string // cuerpo: mensaje de error, contexto, listado de fallos
}): Promise<void> {
  try {
    const html = `<div style="font-family:Inter,system-ui,sans-serif;max-width:640px">
  <h2 style="color:#B42318;margin:0 0 8px">⚠️ Alerta Herohome — ${escapeHtml(params.source)}</h2>
  <p style="font-size:15px;font-weight:600;margin:0 0 12px">${escapeHtml(params.subject)}</p>
  <pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px;background:#F4F4F5;padding:12px;border-radius:8px;border:1px solid #E4E4E7">${escapeHtml(params.detail)}</pre>
  <p style="color:#71717A;font-size:12px;margin-top:12px">${new Date().toISOString()} · entorno de producción</p>
</div>`
    await sendEmail({
      to: ALERT_TO,
      subject: `⚠️ [Herohome] ${params.source}: ${params.subject}`,
      html,
    })
  } catch (_e) {
    // best-effort: no propagamos fallos de la propia alerta.
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c))
}

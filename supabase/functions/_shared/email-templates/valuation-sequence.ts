// Secuencia de 3 emails automáticos para leads del formulario de valoración de
// vivienda (prospecto vendedor). Se envían vía Resend desde `valuation-sequence`:
//   1) inmediato  2) +24 h  3) +72 h
// Estilo alineado con el resto de emails (welcome.ts / shell.ts): Inter, #5B5CFF,
// #0A0E17, #F8FAFC, logo Pulse en HTML puro, footer oscuro. Mobile-first.
// Los previews validados viven en docs/mockups/valuation-emails/.

import { escapeHtml } from "./shell.ts"

// Imágenes alojadas en Supabase Storage (bucket público email-assets).
const IMG_VISITAS =
  "https://zqkvcphtqmibttgnivku.supabase.co/storage/v1/object/public/email-assets/visitas-pendientes.png"
const IMG_CHAT =
  "https://zqkvcphtqmibttgnivku.supabase.co/storage/v1/object/public/email-assets/Hero-chat.png"

// CTAs → secciones de la home.
const CTA_CALC = "https://herohome.es/#precios"
const CTA_COMO = "https://herohome.es/#como-funciona"
const CTA_HERO = "https://herohome.es/#hero-ia"

// Contacto y baja.
const WA_URL =
  "https://wa.me/34630751595?text=Hola%2C%20he%20solicitado%20una%20valoraci%C3%B3n%20en%20Herohome%20y%20tengo%20una%20duda"
const UNSUB_URL = "mailto:hola@herohome.es?subject=BAJA"

// Asuntos (exportados para que el remitente los reutilice / se testeen).
export const VALUATION_SUBJECTS = {
  email1: "Gracias — empezamos con la valoración de tu vivienda",
  email2: "Vende tu casa a tu ritmo, sin depender de una agencia",
  email3: "Te presento a Hero, tu agente que no duerme",
} as const

const FONT = "Inter,system-ui,-apple-system,sans-serif"

// Saludo con nombre opcional (ya escapado). Sin nombre → cadena vacía.
function greet(firstName?: string): string {
  const n = (firstName ?? "").trim()
  return n ? `Hola ${escapeHtml(n)}, ` : ""
}

// Botón CTA violeta centrado.
function ctaButton(url: string, label: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:4px 0 8px 0;">
                    <a href="${url}" target="_blank" style="display:inline-block;background-color:#5B5CFF;color:#FFFFFF;font-family:${FONT};font-size:16px;font-weight:600;text-decoration:none;padding:16px 32px;border-radius:7px;">${escapeHtml(
    label
  )}</a>
                  </td>
                </tr>
              </table>`
}

// Panel con captura de la app (borde sutil coherente con las tarjetas).
function screenshotPanel(src: string, alt: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
                <tr>
                  <td align="center" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:20px 0;">
                    <img src="${src}" width="240" alt="${escapeHtml(
    alt
  )}" style="display:block;width:240px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                  </td>
                </tr>
              </table>`
}

// Shell común: header (logo Pulse), separador, cuerpo, bloque WhatsApp y footer.
function shell(opts: { title: string; preheader: string; inner: string }): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:${FONT};">

  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F8FAFC;font-size:1px;line-height:1px;">
    ${escapeHtml(opts.preheader)}
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E2E8F0;">

          <!-- Header -->
          <tr>
            <td style="padding:24px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:top;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="vertical-align:top;">
                          <div style="width:10px;height:40px;border-radius:3px;background-color:#5B5CFF;background-image:linear-gradient(to bottom,#A5A6FF,#3C3ECC);"><!--[if gte mso 9]><v:rect style="width:10px;height:40px;" fillcolor="#5B5CFF" stroked="f"><v:fill type="gradient" color="#A5A6FF" color2="#3C3ECC" angle="270"/></v:rect><![endif]--></div>
                        </td>
                        <td style="width:6px;"></td>
                        <td style="vertical-align:top;padding-top:10px;">
                          <div style="width:10px;height:30px;border-radius:3px;background-color:#5B5CFF;background-image:linear-gradient(to bottom,#5B5CFF,#282999);"><!--[if gte mso 9]><v:rect style="width:10px;height:30px;" fillcolor="#5B5CFF" stroked="f"><v:fill type="gradient" color="#5B5CFF" color2="#282999" angle="270"/></v:rect><![endif]--></div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="width:12px;"></td>
                  <td style="vertical-align:middle;">
                    <span style="font-family:${FONT};font-size:20px;font-weight:600;letter-spacing:-0.03em;color:#0A0E17;">Herohome</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px;">
              <div style="height:1px;background-color:#E2E8F0;"></div>
            </td>
          </tr>

          <!-- Cuerpo -->
          <tr>
            <td style="padding:32px 24px 8px 24px;">
              ${opts.inner}
            </td>
          </tr>

          <!-- Bloque de contacto WhatsApp -->
          <tr>
            <td style="padding:16px 24px 28px 24px;">
              <div style="height:1px;background-color:#E2E8F0;margin-bottom:20px;"></div>
              <p style="margin:0 0 12px 0;font-family:${FONT};font-size:14px;font-weight:400;line-height:1.5;color:#64748B;text-align:center;">
                ¿Tienes cualquier duda? Escríbenos y te respondemos.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <a href="${WA_URL}" target="_blank" style="display:inline-block;background-color:#25D366;color:#FFFFFF;font-family:${FONT};font-size:15px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:7px;">💬&nbsp;&nbsp;Escríbenos por WhatsApp</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Pie -->
          <tr>
            <td style="background-color:#0A0E17;border-radius:0 0 12px 12px;padding:24px;">
              <p style="margin:0 0 12px 0;font-family:${FONT};font-size:13px;color:#94A3B8;text-align:center;">
                Herohome — Vende tu casa sin agencia &nbsp;·&nbsp;
                <a href="https://herohome.es" target="_blank" style="color:#5B5CFF;text-decoration:none;">herohome.es</a>
              </p>
              <p style="margin:0;font-family:${FONT};font-size:11px;color:#64748B;line-height:1.5;text-align:center;">
                Recibes este correo porque solicitaste una valoración en herohome.es.<br />
                Si no deseas recibir más correos, <a href="${UNSUB_URL}" style="color:#94A3B8;text-decoration:underline;">date de baja</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Email 1 — inmediato: gracias + tabla de ahorro ──────────────────────────
export function valuationEmail1Html({ firstName }: { firstName?: string }): string {
  const heading = `¡Gracias por confiar en Herohome${
    (firstName ?? "").trim() ? ", " + escapeHtml(firstName!.trim()) : ""
  }!`
  const inner = `
              <p style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;font-weight:600;letter-spacing:-0.03em;color:#0A0E17;">${heading}</p>

              <p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                Hemos recibido tu solicitud de valoración. Uno de nuestros expertos se pondrá en contacto contigo en <strong style="font-weight:600;">menos de 24 horas</strong> para conocer los detalles de tu vivienda y que la valoración sea lo más precisa posible.
              </p>

              <p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                Mientras tanto, echa cuentas. Esta es la diferencia:
              </p>

              <!-- Tabla comparativa de comisiones -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
                <tr>
                  <td width="50%" style="padding:0 6px 0 0;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">
                      <tr>
                        <td style="padding:18px 12px;text-align:center;">
                          <p style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;font-weight:500;color:#64748B;">Agencia tradicional</p>
                          <p style="margin:0;font-family:${FONT};font-size:28px;font-weight:700;letter-spacing:-0.03em;color:#64748B;">4–6%</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" style="padding:0 0 0 6px;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEEEFF;border:1px solid #A5A6FF;border-radius:8px;">
                      <tr>
                        <td style="padding:18px 12px;text-align:center;">
                          <p style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;font-weight:600;color:#3C3ECC;">Herohome</p>
                          <p style="margin:0;font-family:${FONT};font-size:28px;font-weight:700;letter-spacing:-0.03em;color:#5B5CFF;">1%</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 24px 0;font-family:${FONT};font-size:12px;font-weight:400;line-height:1.5;color:#94A3B8;text-align:center;">
                Comisión sobre el precio de venta de tu vivienda.
              </p>

              ${ctaButton(CTA_CALC, "Calcula cuánto te ahorrarías")}`
  return shell({
    title: "Gracias por tu solicitud de valoración",
    preheader: "Un experto te contacta en menos de 24 h. Mientras, calcula cuánto puedes ahorrar.",
    inner,
  })
}

// ── Email 2 — +24 h: libertad + tecnología (captura de visitas) ─────────────
export function valuationEmail2Html({ firstName }: { firstName?: string }): string {
  const g = greet(firstName)
  const inner = `
              <p style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;font-weight:600;letter-spacing:-0.03em;color:#0A0E17;">Tú tienes el control</p>

              <p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                ${g}${g ? "e" : "E"}n una agencia tradicional dependes de sus horarios, sus tiempos y su comisión. Con Herohome, no. Tú decides cuándo se enseña tu vivienda, qué visitas aceptas y qué ofertas te interesan.
              </p>

              ${screenshotPanel(IMG_VISITAS, "Visitas pendientes de confirmar en la app de Herohome")}

              <p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                Nosotros publicamos tu vivienda, filtramos a los interesados y organizamos las visitas. La tecnología se encarga del trabajo pesado para que tú vendas a tu ritmo, desde el móvil y con todo el proceso a la vista en un solo lugar.
              </p>

              <p style="margin:0 0 24px 0;font-family:${FONT};font-size:16px;font-weight:600;line-height:1.6;color:#0A0E17;">
                Sin ataduras. Sin intermediarios de por medio. Sin la comisión de siempre.
              </p>

              ${ctaButton(CTA_COMO, "Descubre cómo funciona")}`
  return shell({
    title: "Vende tu casa a tu ritmo",
    preheader: "La tecnología hace el trabajo pesado. Tú tomas las decisiones.",
    inner,
  })
}

// ── Email 3 — +72 h: te presento a Hero (captura del chat) ──────────────────
export function valuationEmail3Html({ firstName }: { firstName?: string }): string {
  const g = greet(firstName)
  const inner = `
              <p style="margin:0 0 4px 0;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#5B5CFF;">Tu agente personal</p>
              <p style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;font-weight:600;letter-spacing:-0.03em;color:#0A0E17;">Este es Hero</p>

              <p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                ${g}${g ? "v" : "V"}ender por tu cuenta no significa hacerlo solo. Hero es tu agente inmobiliario personal, y trabaja para ti las 24 horas del día, todos los días.
              </p>

              ${screenshotPanel(IMG_CHAT, "Chat con Hero en la app de Herohome")}

              <p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                Responde al instante a cada interesado, resuelve sus dudas, agenda las visitas y te avisa en cuanto llega una oferta. Tú solo tomas las decisiones importantes; del resto se encarga Hero.
              </p>

              <p style="margin:0 0 24px 0;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                Así vendes tu casa como un profesional —sin serlo— y sin pagar lo que cuesta una agencia.
              </p>

              ${ctaButton(CTA_HERO, "Descubre todo lo que hace Hero")}`
  return shell({
    title: "Te presento a Hero",
    preheader: "Responde a los interesados 24/7, agenda las visitas y te avisa de cada oferta.",
    inner,
  })
}

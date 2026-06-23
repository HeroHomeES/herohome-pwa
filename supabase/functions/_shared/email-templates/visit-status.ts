// Plantillas de email para confirmación / cancelación de visita (PC).
// Branding alineado con welcome.ts (Inter, #5B5CFF, #0A0E17, #F8FAFC).

interface VisitEmailParams {
  visitorName: string
  propertyAddress: string
  dateTime: string
}

export function visitConfirmationHtml(params: VisitEmailParams): string {
  return emailShell({
    accentColor: "#16A34A",
    heading: `¡Tu visita está confirmada! ✅`,
    intro: `Hola ${escapeHtml(params.visitorName)}, hemos confirmado tu visita. Aquí tienes los detalles:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Fecha y hora", value: params.dateTime },
    ],
    closing:
      "Si necesitas cambiar o cancelar la visita, respóndenos por WhatsApp y te ayudamos enseguida. ¡Te esperamos!",
  })
}

export function visitCancellationHtml(params: VisitEmailParams): string {
  return emailShell({
    accentColor: "#DC2626",
    heading: `Tu visita ha sido cancelada`,
    intro: `Hola ${escapeHtml(params.visitorName)}, lamentamos informarte de que esta visita ha sido cancelada:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Fecha y hora", value: params.dateTime },
    ],
    closing:
      "Si quieres, escríbenos por WhatsApp y te ayudamos a reagendarla en otro horario que te venga mejor.",
  })
}

// Email dirigido al PROPIETARIO (CV) cuando un comprador cancela una visita
// que estaba confirmada.
export function ownerVisitCanceledByVisitorHtml(params: {
  ownerName?: string
  visitorName: string
  propertyAddress: string
  dateTime: string
}): string {
  const saludo = params.ownerName ? `Hola ${params.ownerName}, ` : "Hola, "
  return emailShell({
    accentColor: "#DC2626",
    heading: "Un comprador ha cancelado su visita",
    intro: `${saludo}te informamos de que un comprador ha cancelado una visita que tenías confirmada en tu vivienda:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Visita cancelada", value: params.dateTime },
      { label: "Comprador", value: params.visitorName },
    ],
    closing: "Puedes consultar el estado de tus visitas en tu panel de Herohome.",
  })
}

function emailShell(opts: {
  accentColor: string
  heading: string
  intro: string
  detailRows: { label: string; value: string }[]
  closing: string
}): string {
  const rows = opts.detailRows
    .map(
      (r) => `
                <tr>
                  <td style="padding:12px 0 2px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:13px;color:#64748B;">${escapeHtml(
                    r.label
                  )}</td>
                </tr>
                <tr>
                  <td style="padding:0 0 4px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;font-weight:600;color:#0A0E17;">${escapeHtml(
                    r.value
                  )}</td>
                </tr>`
    )
    .join("")

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:Inter,system-ui,-apple-system,sans-serif;">
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
                          <div style="width:10px;height:40px;border-radius:3px;background-color:#5B5CFF;background-image:linear-gradient(to bottom,#A5A6FF,#3C3ECC);"></div>
                        </td>
                        <td style="width:6px;"></td>
                        <td style="vertical-align:top;padding-top:10px;">
                          <div style="width:10px;height:30px;border-radius:3px;background-color:#5B5CFF;background-image:linear-gradient(to bottom,#5B5CFF,#282999);"></div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="width:12px;"></td>
                  <td style="vertical-align:middle;">
                    <span style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:20px;font-weight:600;letter-spacing:-0.03em;color:#0A0E17;">Herohome</span>
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
            <td style="padding:32px 24px 24px 24px;">
              <p style="margin:0 0 16px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:24px;font-weight:600;letter-spacing:-0.03em;color:${
                opts.accentColor
              };">${escapeHtml(opts.heading)}</p>

              <p style="margin:0 0 8px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                ${escapeHtml(opts.intro)}
              </p>

              <!-- Detalles -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">
                <tr>
                  <td style="padding:8px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:16px 0 0 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:16px;font-weight:400;line-height:1.6;color:#0A0E17;">
                ${escapeHtml(opts.closing)}
              </p>
            </td>
          </tr>

          <!-- Pie -->
          <tr>
            <td style="background-color:#0A0E17;border-radius:0 0 12px 12px;padding:24px;">
              <p style="margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:13px;color:#94A3B8;text-align:center;">
                Herohome — Vende tu casa sin agencia &nbsp;·&nbsp;
                <a href="https://herohome.es" target="_blank" style="color:#5B5CFF;text-decoration:none;">herohome.es</a>
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

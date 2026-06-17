export function idealistaLeadAlertHtml({
  reason,
  extracted,
  rawSubject,
  rawBody,
}: {
  reason: string
  extracted?: Record<string, unknown>
  rawSubject?: string
  rawBody: string
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fallo al procesar lead de Idealista</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:Inter,system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E2E8F0;">

          <tr>
            <td style="padding:24px;">
              <span style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:20px;font-weight:600;letter-spacing:-0.03em;color:#0A0E17;">Herohome</span>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px;">
              <div style="height:1px;background-color:#E2E8F0;"></div>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 24px 24px 24px;">
              <p style="margin:0 0 16px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:20px;font-weight:600;color:#DC2626;">
                ⚠️ No se ha podido procesar un lead de Idealista
              </p>

              <p style="margin:0 0 16px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#0A0E17;">
                <strong>Motivo:</strong> ${reason}
              </p>

              ${
                extracted
                  ? `<p style="margin:0 0 16px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#0A0E17;">
                <strong>Datos extraídos:</strong><br/>
                <code style="display:block;white-space:pre-wrap;background-color:#F1F5F9;border-radius:6px;padding:12px;font-size:13px;color:#0A0E17;margin-top:8px;">${escapeHtml(
                  JSON.stringify(extracted, null, 2)
                )}</code>
              </p>`
                  : ""
              }

              ${
                rawSubject
                  ? `<p style="margin:0 0 8px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#0A0E17;">
                <strong>Asunto del email:</strong> ${escapeHtml(rawSubject)}
              </p>`
                  : ""
              }

              <p style="margin:0 0 8px 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#0A0E17;">
                <strong>Contenido del email original:</strong>
              </p>
              <code style="display:block;white-space:pre-wrap;background-color:#F1F5F9;border-radius:6px;padding:12px;font-size:13px;color:#0A0E17;">${escapeHtml(
                rawBody
              )}</code>

              <p style="margin:24px 0 0 0;font-family:Inter,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#0A0E17;">
                Revisa el lead manualmente y contacta con el comprador si procede.
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

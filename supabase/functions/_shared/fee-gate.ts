// Piezas DETERMINISTAS del gate de honorarios del comprador (B13).
// Viven en un módulo compartido para poder testearlas (fee-gate.test.ts):
// son las piezas con consecuencias legales — el texto del consentimiento debe
// ser verbatim y la clasificación de la respuesta, inequívoca y sin LLM.

export function formatFeePercent(pct: number): string {
  // 1 → "1"; 0.5 → "0,5" (coma decimal en español, sin ceros sobrantes).
  return Number.isInteger(pct) ? String(pct) : String(pct).replace(".", ",")
}

// Importe en euros con formato español ("3.000 €").
export function formatEur(amount: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount)
}

// salesPrice se pasa para mostrar un € ORIENTATIVO. Es opcional: si no se conoce
// (o en gates abiertos antes de añadir este dato a agent_state) el mensaje sale
// solo con el %, idéntico al texto histórico → consent_text retrocompatible.
export function buildFeeMessage(pct: number, salesPrice: number | null = null): string {
  const amount = pct > 0 && salesPrice && salesPrice > 0 ? Math.round((salesPrice * pct) / 100) : null
  const estimate =
    amount != null
      ? ` Sobre el precio actual de ${formatEur(salesPrice!)}, supondría aproximadamente ${formatEur(amount)}; el importe final se calculará sobre el precio que finalmente se acuerde con el vendedor.`
      : ""
  return `Antes de confirmar tu visita, necesito que conozcas las condiciones del servicio:

Herohome cobra una comisión del ${formatFeePercent(pct)}% sobre el precio de venta al comprador. Esta comisión se devenga si formalizas una oferta de compra sobre esta propiedad que es aceptada por el vendedor.${estimate}

Puedes consultar las condiciones completas en: herohome.es/honorarios

¿Aceptas estas condiciones para continuar? Responde SÍ para confirmar tu visita.`
}

// Clasificación determinista de la respuesta del PC al gate (normalizada a
// minúsculas + trim antes de evaluar). Sin LLM: robustez legal.
const FEE_ACCEPT_TOKENS = new Set(["sí", "si", "acepto", "ok", "vale", "perfecto", "confirmo"])
const FEE_ACCEPT_PHRASES = ["de acuerdo"]
const FEE_REJECT_TOKENS = new Set(["no", "cancelar"])
const FEE_REJECT_PHRASES = ["no acepto"]

// Clasifica la respuesta del PC al mensaje de honorarios.
// - Las PREGUNTAS son siempre ambiguas: "¿no incluye IVA?" contiene el token
//   "no" pero NO es un rechazo (antes se clasificaba como reject). Una duda
//   nunca es consentimiento ni negativa inequívoca → se repregunta.
// - El rechazo se evalúa antes que la aceptación para que "no acepto" gane
//   sobre el token "acepto".
export function classifyFeeReply(text: string): "accept" | "reject" | "ambiguous" {
  const norm = text.toLowerCase().trim()
  if (norm.includes("?") || norm.includes("¿")) return "ambiguous"
  const tokens = new Set(norm.split(/[^a-záéíóúñü]+/i).filter(Boolean))
  if (FEE_REJECT_PHRASES.some((p) => norm.includes(p))) return "reject"
  for (const t of FEE_REJECT_TOKENS) if (tokens.has(t)) return "reject"
  if (FEE_ACCEPT_PHRASES.some((p) => norm.includes(p))) return "accept"
  for (const t of FEE_ACCEPT_TOKENS) if (tokens.has(t)) return "accept"
  return "ambiguous"
}

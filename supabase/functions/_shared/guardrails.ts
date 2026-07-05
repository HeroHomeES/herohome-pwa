// Regex de los guardarraíles anti-alucinación de los dos agentes de Hero.
// En módulo compartido para poder testearlos (guardrails.test.ts): un falso
// negativo aquí significa mentirle a un comprador o a un propietario.

// whatsapp-agent (comprador): detecta que el texto final afirma o "narra" una
// reserva/registro ("tu visita está reservada", "Reservando… un momento") sin
// que la tool correspondiente haya tenido éxito en el turno.
export const BOOKING_CLAIM_REGEX =
  /(reserv|solicit|agend|confirm|registr)\w*(ad|and)|un momento|enseguida|procesando/i

// chat-with-hero (propietario): afirmaciones en primera persona de acción
// completada ("he confirmado", "la he cancelado", "queda bloqueada"). Acotado
// para no chocar con descripciones de estado ("tienes una visita confirmada").
export const ACTION_CLAIM_REGEX =
  /\b(?:(?:ya\s+)?(?:la|lo|las|los)\s+he|(?:ya\s+)?he|queda[ns]?)\s+(?:confirmad|cancelad|bloquead|anulad)[oa]s?\b/i

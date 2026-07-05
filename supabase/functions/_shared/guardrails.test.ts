// Tests de los guardarraíles anti-alucinación de los dos agentes.
// Ejecutar: deno test supabase/functions/_shared/

import { assertEquals } from "jsr:@std/assert@1"
import { ACTION_CLAIM_REGEX, BOOKING_CLAIM_REGEX } from "./guardrails.ts"

// --- BOOKING_CLAIM_REGEX (whatsapp-agent, comprador) ---

Deno.test("detecta afirmaciones de reserva sin tool", () => {
  assertEquals(BOOKING_CLAIM_REGEX.test("¡Tu visita está reservada!"), true)
  assertEquals(BOOKING_CLAIM_REGEX.test("Tu visita ha quedado registrada"), true)
  assertEquals(BOOKING_CLAIM_REGEX.test("He confirmado tu visita para el jueves"), true)
  assertEquals(BOOKING_CLAIM_REGEX.test("Tu solicitud está agendada"), true)
})

Deno.test("detecta 'narración' de reserva que cuelga el turno", () => {
  assertEquals(BOOKING_CLAIM_REGEX.test("Reservando tu visita… un momento"), true)
  assertEquals(BOOKING_CLAIM_REGEX.test("Enseguida lo tienes"), true)
  assertEquals(BOOKING_CLAIM_REGEX.test("Procesando tu solicitud"), true)
})

Deno.test("no dispara con ofertas de reservar (futuro/infinitivo)", () => {
  assertEquals(BOOKING_CLAIM_REGEX.test("¿Quieres reservar una visita?"), false)
  assertEquals(BOOKING_CLAIM_REGEX.test("Puedo mostrarte los horarios para reservar"), false)
  assertEquals(BOOKING_CLAIM_REGEX.test("¿Te muestro los horarios disponibles?"), false)
})

// --- ACTION_CLAIM_REGEX (chat-with-hero, propietario) ---

Deno.test("detecta afirmaciones en primera persona de acción completada", () => {
  assertEquals(ACTION_CLAIM_REGEX.test("He confirmado la visita del jueves"), true)
  assertEquals(ACTION_CLAIM_REGEX.test("La he cancelado, aviso al interesado"), true)
  assertEquals(ACTION_CLAIM_REGEX.test("Ya he bloqueado esos días"), true)
  assertEquals(ACTION_CLAIM_REGEX.test("Queda bloqueada tu agenda del viernes"), true)
  assertEquals(ACTION_CLAIM_REGEX.test("Quedan canceladas las dos visitas"), true)
})

Deno.test("no dispara con descripciones de estado legítimas", () => {
  assertEquals(ACTION_CLAIM_REGEX.test("Tienes una visita confirmada el jueves"), false)
  assertEquals(ACTION_CLAIM_REGEX.test("Hay dos visitas pendientes y una cancelada"), false)
  assertEquals(ACTION_CLAIM_REGEX.test("¿Quieres que confirme la visita?"), false)
  assertEquals(ACTION_CLAIM_REGEX.test("Para confirmar necesito que me digas cuál"), false)
})

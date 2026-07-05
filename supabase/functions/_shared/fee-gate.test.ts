// Tests del gate de honorarios (piezas deterministas, con consecuencias
// legales). Ejecutar: deno test supabase/functions/_shared/
// Corren también en CI (.github/workflows/test.yml) en cada push.

import { assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert@1"
import { buildFeeMessage, classifyFeeReply, formatFeePercent } from "./fee-gate.ts"

// --- classifyFeeReply: aceptaciones inequívocas ---

Deno.test("acepta: sí / si / SÍ con adorno", () => {
  assertEquals(classifyFeeReply("Sí"), "accept")
  assertEquals(classifyFeeReply("si"), "accept")
  assertEquals(classifyFeeReply("SÍ, claro"), "accept")
})

Deno.test("acepta: tokens y frases de aceptación", () => {
  assertEquals(classifyFeeReply("acepto"), "accept")
  assertEquals(classifyFeeReply("vale"), "accept")
  assertEquals(classifyFeeReply("ok"), "accept")
  assertEquals(classifyFeeReply("Perfecto, gracias"), "accept")
  assertEquals(classifyFeeReply("confirmo"), "accept")
  assertEquals(classifyFeeReply("de acuerdo"), "accept")
})

// --- classifyFeeReply: rechazos inequívocos ---

Deno.test("rechaza: no / no gracias / cancelar", () => {
  assertEquals(classifyFeeReply("no"), "reject")
  assertEquals(classifyFeeReply("No, gracias"), "reject")
  assertEquals(classifyFeeReply("cancelar"), "reject")
})

Deno.test("el rechazo gana sobre la aceptación: 'no acepto'", () => {
  assertEquals(classifyFeeReply("no acepto"), "reject")
  assertEquals(classifyFeeReply("No acepto esas condiciones"), "reject")
})

// --- classifyFeeReply: las PREGUNTAS son ambiguas (nunca rechazo/aceptación) ---

Deno.test("una pregunta con 'no' NO es un rechazo", () => {
  assertEquals(classifyFeeReply("¿no incluye IVA?"), "ambiguous")
  assertEquals(classifyFeeReply("no entiendo, ¿qué comisión?"), "ambiguous")
})

Deno.test("una pregunta con 'sí/acepto' NO es una aceptación", () => {
  assertEquals(classifyFeeReply("sí?"), "ambiguous")
  assertEquals(classifyFeeReply("¿acepto y ya está?"), "ambiguous")
})

Deno.test("preguntas informativas son ambiguas", () => {
  assertEquals(classifyFeeReply("¿cuánto sería en euros?"), "ambiguous")
  assertEquals(classifyFeeReply("cuanto era?"), "ambiguous")
})

// --- classifyFeeReply: ambiguos varios ---

Deno.test("mensajes ambiguos", () => {
  assertEquals(classifyFeeReply("quizás"), "ambiguous")
  assertEquals(classifyFeeReply("déjame pensarlo"), "ambiguous")
  assertEquals(classifyFeeReply(""), "ambiguous")
  assertEquals(classifyFeeReply("   "), "ambiguous")
})

Deno.test("tokens dentro de otras palabras no disparan", () => {
  // "sinceramente" contiene "si"; "novato" contiene "no" — pero como
  // subcadena, no como palabra completa.
  assertEquals(classifyFeeReply("sinceramente me lo pienso"), "ambiguous")
  assertEquals(classifyFeeReply("soy novato en esto"), "ambiguous")
})

// --- formatFeePercent: formato español del % ---

Deno.test("formatFeePercent: enteros sin decimales, decimales con coma", () => {
  assertEquals(formatFeePercent(1), "1")
  assertEquals(formatFeePercent(2), "2")
  assertEquals(formatFeePercent(0.5), "0,5")
  assertEquals(formatFeePercent(1.9), "1,9")
})

// --- buildFeeMessage: texto verbatim del consentimiento ---

Deno.test("buildFeeMessage sin precio: solo % (texto histórico retrocompatible)", () => {
  const msg = buildFeeMessage(1)
  assertStringIncludes(msg, "comisión del 1% sobre el precio de venta")
  assertStringIncludes(msg, "Responde SÍ para confirmar tu visita.")
  assertEquals(msg.includes("Sobre el precio actual"), false)
})

Deno.test("buildFeeMessage con precio: incluye el € orientativo redondeado", () => {
  const msg = buildFeeMessage(1, 900_000)
  assertStringIncludes(msg, "Sobre el precio actual de")
  assertStringIncludes(msg, "900.000")
  // 1% de 900.000 € = 9000 €. Ojo: Intl es-ES NO pone separador de miles en
  // números de 4 cifras ("9000 €", no "9.000 €") — comportamiento verificado.
  assertMatch(msg, /aproximadamente 9\.?000\s?€/)
  assertStringIncludes(msg, "el importe final se calculará sobre el precio que finalmente se acuerde")
})

Deno.test("buildFeeMessage con % decimal: coma española y cálculo correcto", () => {
  const msg = buildFeeMessage(1.9, 50_000)
  assertStringIncludes(msg, "comisión del 1,9%")
  assertStringIncludes(msg, "950") // 1,9% de 50.000 €
})

Deno.test("buildFeeMessage reconstruye idéntico (verbatim del consent_text)", () => {
  // El texto registrado en consents se RECONSTRUYE al aceptar: debe ser
  // determinista — misma entrada, mismo texto, byte a byte.
  assertEquals(buildFeeMessage(1, 900_000), buildFeeMessage(1, 900_000))
  assertEquals(buildFeeMessage(0.5), buildFeeMessage(0.5))
})

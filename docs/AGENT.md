# AGENT.md — Diseño del agente conversacional "Hero" (WhatsApp)

> Documento legible de cómo está modelado el agente de WhatsApp. La fuente de
> verdad sigue siendo el código: el **system prompt** vive en `buildSystemPrompt()`
> y las **tools** en el array `TOOLS`, ambos en `supabase/functions/whatsapp-agent/index.ts`.
> Si cambias el comportamiento del agente, edita el código y actualiza este documento.

---

## 1. Qué es

**Hero** es el asistente conversacional de Herohome que habla por **WhatsApp** con el
**Potencial Comprador (PC)**. Vive en la Edge Function `whatsapp-agent` (no en Make).

- **Modelo:** `claude-sonnet-4-6` (Anthropic API). Se eligió Sonnet por su mejor
  disciplina de *tool-calling* (Haiku alucinaba/“narraba” reservas sin ejecutarlas).
- **Idioma:** español. **Tono:** cercano, profesional y breve (mensajes cortos, estilo WhatsApp).
- **Canal de entrada/salida:** webhook de Meta (entrante) + WhatsApp Cloud API (saliente).

## 2. Objetivo

Ayudar al comprador a:
1. **Consultar** la disponibilidad de visitas de la vivienda.
2. **Reservar** una visita.
3. **Cancelar** o **reagendar** su visita.

## 3. Contexto que se le inyecta (por conversación)

En cada turno, el system prompt se construye con el contexto de **la vivienda asociada
a esa conversación** (dirección y precio), que se obtiene de `whatsapp_conversations.property_id`.

- Si **hay vivienda asociada** → Hero opera con normalidad sobre esa vivienda.
- Si **no hay vivienda asociada** → no usa las tools de visitas; pide al comprador que
  contacte desde el anuncio de Idealista (el vínculo teléfono↔vivienda lo crea
  `process-idealista-lead` a partir del lead de Idealista).

## 4. Reglas de comportamiento (resumen del system prompt)

- **RGPD / consentimiento:** antes de reservar, exige nombre, apellidos, **email
  (obligatorio)** y **consentimiento explícito** a los términos y condiciones
  (`https://www.herohome.es/terminos-y-condiciones`). El **DNI NO se pide** en la visita
  (se captura en la oferta, B9).
- **Anti-alucinación (crítico):** NUNCA afirma que una visita está reservada/confirmada
  salvo que `request_visit` haya devuelto éxito en ese mismo turno. Aplica también al
  reagendar (tener los datos no reserva nada). No “narra” la reserva (“Reservando…”,
  “un momento”) sin llamar a la tool en el mismo turno. *(Reforzado además por un
  guardarraíl en código — ver §7.)*
- **No inventa** horarios, propiedades ni datos que no provengan de las tools.
- **No envía emails** ni realiza acciones fuera de sus tools: el aviso de confirmación
  (WhatsApp + email) lo manda el sistema automáticamente cuando el propietario confirma.

## 5. Procedimientos

**Reservar:** 1) recoge nombre + email + consentimiento → 2) llama a `get_available_slots`
para obtener los `slot_id` actuales → 3) localiza el `slot_id` del día/hora elegido →
4) llama a `request_visit` → 5) confirma SOLO si `request_visit` tuvo éxito (e informa de
que el propietario confirmará y avisará por WhatsApp/email).

**Cancelar / reagendar:** usa `cancel_visit_by_visitor`. Si devuelve `needs_selection`
(varias visitas) pregunta cuál; si `no_visits`, lo dice; si cancela con éxito, **ofrece
reagendar** mostrando `get_available_slots`.

## 6. Tools (capacidades)

| Tool | Qué hace | Implementación |
|---|---|---|
| `get_available_slots` | Lista huecos disponibles de la vivienda (agrupados por día) | Edge Function `get-available-slots` |
| `request_visit` | Reserva una visita (slot → `Pending to confirm`) + registra consentimiento + notifica al CV | Edge Function `request-visit-slot` |
| `cancel_visit_by_visitor` | Cancela una visita propia del PC (slot → `Canceled by visitor`) + notifica al CV | Edge Function `cancel-visit-by-visitor` |

Las tools del agente se ejecutan en `executeTool()`, que llama internamente a esas Edge
Functions (con `Authorization: Bearer <anon>` + `x-api-key`).

## 7. Cómo razona (loop + guardarraíl)

1. Se carga el **historial** de la conversación (`whatsapp_conversations.messages`, solo
   texto `{role, content}`) + el mensaje nuevo del comprador.
2. `runToolLoop()` ejecuta el bucle de tool-calling (máx. 5 iteraciones): llama al modelo,
   si pide una tool la ejecuta y le devuelve el resultado, y repite hasta que el modelo
   responde texto final.
3. **Guardarraíl anti-alucinación:** si el texto final afirma/“narra” una reserva
   (`reservando`, `reservada`, `confirmada`, `un momento`…) pero `request_visit` NO tuvo
   éxito en el turno, se inyecta una corrección y se reintenta; si aún así no reserva, se
   sustituye por un mensaje seguro (nunca se le miente al comprador).
4. Se responde por WhatsApp Cloud API y se persiste el turno con `save-message`.

> **Limitación conocida:** el historial persistido es solo texto, no los bloques de
> tool-calling. Por eso el agente **re-consulta los slots en cada turno** de reserva
> (los `slot_id` no sobreviven entre mensajes).

## 8. Dónde tocar para iterar el agente

- **Persona / objetivos / reglas / tono:** `buildSystemPrompt()` en `whatsapp-agent/index.ts`.
- **Capacidades (tools):** array `TOOLS` + `executeTool()` en el mismo archivo.
- **Modelo:** constante `CLAUDE_MODEL`.
- Tras editar: `supabase functions deploy whatsapp-agent`.

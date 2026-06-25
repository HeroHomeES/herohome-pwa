# AGENT.md — Diseño del agente conversacional "Hero"

> Documento legible de cómo está modelado Hero. La fuente de verdad sigue siendo
> el código (`buildSystemPrompt()` + array `TOOLS` de cada función).
> Si cambias el comportamiento, edita el código y actualiza este documento.
>
> **Hay DOS instancias de Hero**, mismo modelo (`claude-sonnet-4-6`) y misma
> arquitectura (loop de tool-calling inline + guardarraíl anti-alucinación):
> - **§1–§8 — Agente WhatsApp** (`whatsapp-agent`): habla con el **comprador (PC)**.
> - **§9 — Agente PWA** (`chat-with-hero`): habla con el **propietario (CV)**.

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
4. **Hacer una oferta** de compra y **negociar** (responder a las contraofertas del propietario).
5. **Dar feedback** tras la visita (y, si le interesa, ofertar).

## 3. Contexto que se le inyecta (por conversación)

En cada turno, el system prompt se construye con el contexto de **la vivienda asociada
a esa conversación** (dirección y precio), que se obtiene de `whatsapp_conversations.property_id`.

Además, si el comprador tiene **ofertas vivas** en esa vivienda se inyecta un resumen de la
negociación (`loadBuyerContext`): p.ej. una contraoferta del propietario pendiente de su
respuesta, o una oferta suya ya presentada (para no duplicarla).

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
| `cancel_visit_by_visitor` | Cancela una visita propia del PC (slot → `Canceled by visitor`) + avisa al CV: notificación in-app (Realtime) + email si estaba `Confirmed` | Edge Function `cancel-visit-by-visitor` |
| `create_offer` | Registra una oferta del PC (importe + DNI); verifica honorarios; avisa al CV (in-app + email) y al equipo | Edge Function `create-offer` |
| `respond_to_counteroffer` | El PC acepta/rechaza la contraoferta viva del CV; cierra la negociación y avisa al CV/equipo | Edge Function `respond-counteroffer` |
| `save_visit_feedback` | Guarda el feedback post-visita del PC (outcome + motivo, texto raw) en la visita | Edge Function `save-visit-feedback` |

Las tools del agente se ejecutan en `executeTool()`, que llama internamente a esas Edge
Functions (con `Authorization: Bearer <anon>` + `x-api-key`).

## 7. Cómo razona (loop + guardarraíl)

1. Se carga el **historial** de la conversación (`whatsapp_conversations.messages`, solo
   texto `{role, content}`) + el mensaje nuevo del comprador.
2. `runToolLoop()` ejecuta el bucle de tool-calling (máx. 5 iteraciones): llama al modelo,
   si pide una tool la ejecuta y le devuelve el resultado, y repite hasta que el modelo
   responde texto final.
3. **Guardarraíl anti-alucinación:** si el texto final afirma una reserva (cualquier forma
   de reservar/solicitar/agendar/confirmar/registrar en -ado/-ada/-ando, o "un momento" /
   "procesando") pero `request_visit` NO tuvo éxito en el turno, se inyecta una corrección y
   se reintenta; si aún así no reserva, se sustituye por un mensaje seguro (nunca se le miente
   al comprador). Esto además evita contaminar el historial con confirmaciones falsas.
   El guardarraíl también reconoce las **acciones de oferta** con éxito (`create_offer` /
   `respond_to_counteroffer`, vía el flag `offerActionOk`) para no corregir confirmaciones legítimas.
4. Se responde por WhatsApp Cloud API y se persiste el turno con `save-message`.

> **Limitación conocida:** el historial persistido es solo texto, no los bloques de
> tool-calling. Por eso el agente **re-consulta los slots en cada turno** de reserva
> (los `slot_id` no sobreviven entre mensajes).

## 8. Dónde tocar para iterar el agente

- **Persona / objetivos / reglas / tono:** `buildSystemPrompt()` en `whatsapp-agent/index.ts`.
- **Capacidades (tools):** array `TOOLS` + `executeTool()` en el mismo archivo.
- **Modelo:** constante `CLAUDE_MODEL`.
- Tras editar: `supabase functions deploy whatsapp-agent`.

---

## 9. Agente PWA — Hero del propietario (`chat-with-hero`, B10)

La home de la PWA es un chat con Hero que ayuda al **propietario (CV)** a gestionar
su venta. Vive en la Edge Function `chat-with-hero` y es **hermano de `whatsapp-agent`**:
misma estructura inline (`callClaude` / `runToolLoop` / `executeTool` / `ToolContext`),
mismo modelo (`claude-sonnet-4-6`) y mismo guardarraíl anti-alucinación. Fuente de
verdad: `buildSystemPrompt()` + `TOOLS` en `supabase/functions/chat-with-hero/index.ts`.

### Qué es y cómo se invoca
- El front (`HomePage` + `useChatSession`) hace `POST` con el **JWT de sesión del CV**
  y `{ message, session_id }`. `verify_jwt=true` (por defecto, no en `config.toml`).
- **Aislamiento (regla #1):** se decodifica el `sub` del JWT verificado → la vivienda
  del CV (`properties.user_id = sub`). **Todas** las consultas se filtran por ese
  `property_id`. Como las funciones usan `service_role` (saltan RLS), ese filtro por el
  `sub` verificado es el guardia — **nunca** se confía en ids enviados por el cliente.
- **Historial:** se lee de `pwa_chat_sessions` solo para dar contexto (validando que la
  sesión es de ese `user_id`). El front es quien persiste el turno.

### Tools
| Tool | Qué hace | Implementación |
|---|---|---|
| `get_visits` | Lista visitas del CV (pendientes / próximas / pasadas) | Lectura directa (scoped) |
| `get_availability` | Huecos libres próximos | Edge Function `get-available-slots` |
| `get_offers` | Ofertas, contraofertas y estados (informativo) | Lectura directa (scoped) |
| `confirm_visit` | `Pending to confirm` → `Confirmed` + aviso al PC | Edge Function `manage-visit` |
| `cancel_visit` | Cancela (regla 24h) → `Canceled by owner` + aviso al PC | Edge Function `manage-visit` |
| `block_slots` | Bloquea `Available` → `Not available` en un rango | Edge Function `block-visit-slots` |

Convención: **lecturas directas, escrituras vía Edge Function** (igual que el agente de
WhatsApp). `manage-visit` es **fuente única** de las acciones del propietario sobre
visitas — la usa también el front (`useVisits`).

### Reglas (resumen del system prompt)
- **Operativo pero garantista:** ante cualquier duda de si puede/debe hacer algo, NO lo
  hace; sugiere agendar llamada con el asesor (`https://calendar.app.google/evtp4dF7qncxggiYA`
  o `hola@herohome.es`).
- **Confirmación obligatoria** antes de cualquier acción que cambie datos (describe el
  cambio y espera un "sí" explícito). Las consultas (`get_*`) no la requieren.
- **Ofertas:** informa, pero NO actúa (aceptar/rechazar/contraofertar → sección Ofertas).
  Consejo sobre una oferta → "decisión muy relevante" + asesor.
- **Disponibilidad:** solo bloqueo puntual (`block_slots`). Crear huecos o cambiar la
  plantilla semanal → sección Disponibilidad de la app (`create_slots` se descartó en v1
  porque `generate-slots` regenera los `Available` y los borraría).
- **Regla de 24h** en la cancelación: la aplica Hero antes de llamar a `manage-visit`
  (así el botón del front conserva su comportamiento actual).
- **Anti-alucinación:** no afirma haber confirmado/cancelado/bloqueado nada sin éxito real
  de la tool en el turno (guardarraíl en código, acotado a afirmaciones en 1ª persona para
  no chocar con descripciones de estado).

### Dónde tocar
- **Persona / reglas / límites:** `buildSystemPrompt()` en `chat-with-hero/index.ts`.
- **Capacidades:** `TOOLS` + `executeTool()` en el mismo archivo.
- **Acciones del propietario sobre visitas:** `manage-visit` (compartida con el front).
- Tras editar: `supabase functions deploy chat-with-hero` (o push a `main`).

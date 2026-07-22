# B9 — Gestión de Ofertas (+ post-visita) — Guion de construcción

> **Estado:** ✅ desplegado y validado end-to-end (25 jun 2026).
> **Fuente:** sesión de diseño previa al desarrollo. Consolidado para evitar bandazos.
> **Arquitectura:** v3.1 — leer `ARCHITECTURE_V3_DECISIONS (1).md` y `CLAUDE.md`. Este doc no contradice nada de v3.1; lo aterriza para B9.

---

## 0. Decisión de alcance: B11 (post-visita) deja de estar aplazado

Hasta ahora los docs marcaban **B11 (post-visita) como aplazado post-lanzamiento** (`CLAUDE.md:51`, `CLAUDE.md:211`, `ARCHITECTURE…` punto 5 y regla 7). **Cambio de criterio:** el comprador (PC) **nunca sabe cómo hacer una oferta** si no se lo decimos. Por tanto el follow-up post-visita es **camino crítico de B9** y se construye **completo y bien antes de lanzar**.

- **Sí entra:** mensaje post-visita que provoca la oferta + recogida de feedback ligero (motivo del "no").
- **No entra (sigue fuera de Fase 1):** encuestas/feedback estructurado tipo NPS, scoring, etc.
- **Acción al construir:** quitar "B11 post-visita" de las secciones de *aplazado* en `CLAUDE.md` y `ARCHITECTURE_V3_DECISIONS (1).md`.

---

## 1. Resumen del bloque

Dos mitades simétricas + un disparador:

| Pieza | Quién | Canal | Qué hace |
|---|---|---|---|
| **Post-visita** | Sistema → PC | WhatsApp (plantilla) | 1h después de la visita, invita a ofertar o cierra con feedback |
| **create-offer** | PC → sistema | WhatsApp (Hero) | El comprador formaliza una oferta (importe + DNI) |
| **manage-offer** | CV → sistema | PWA | El propietario acepta / rechaza / contraoferta |
| **Negociación** | PC ↔ CV | WhatsApp + PWA | Contraofertas multi-vuelta hasta acuerdo o cierre |

Reglas que se respetan (v3.1): todo email por **Resend**; avisos WhatsApp por **Cloud API directo**; **nada en Make**; **no escribir** en `salesforce_quote_id`; Salesforce congelado (entra en juego solo tras la conversión, manual).

---

## 2. Flujos

### 2.A — Post-visita (disparador)

```
Cron cada 30 min
  → Edge Function post-visit-followup
      busca visit_slots: status='Confirmed' AND end_time < now()-1h AND post_visit_sent_at IS NULL
      → envía plantilla Meta `post_visita` (sin botones) al PC
      → marca post_visit_sent_at = now()  (idempotencia)
      → escribe el mensaje en whatsapp_conversations.messages (para que Hero tenga contexto)

PC responde (texto libre) → whatsapp-agent (Hero)
  ├─ Le interesa  → flujo create-offer (pide DNI + importe)
  └─ No le interesa → "Entiendo, ¿qué es lo que no te encaja?"
                       → guarda post_visit_outcome='not_interested' + post_visit_feedback=<texto literal>
                       → cierra amable
```

- **Sin botones.** El PC responde libre; Hero clasifica intención.
- **Sin ventana horaria** (no habrá visitas de madrugada; si las hubiera, el PC recibe un WhatsApp que espera).
- **Feedback**: Hero captura el motivo y puede **sintetizarlo** (decisión revisada en pruebas: para explicaciones largas se prefiere un resumen, no el texto literal). Se guarda en `visit_slots.post_visit_feedback`.

### 2.B — create-offer (el PC oferta)

```
PC (por WhatsApp): "quiero hacer una oferta de 290.000"
  → Hero tool create_offer(amount, dni)
      1. Verifica consentimiento de honorarios:
         SELECT consents WHERE type='buyer_fee_acknowledgement' AND wa_phone_number AND property_id AND accepted=true
         - Normal: ya existe (se capturó antes de la visita, gate B13) → continúa.
         - Raro (no existe): reutiliza el gate existente (FEE_MESSAGE + recordFeeConsent). NO se monta nada nuevo.
      2. Lookup email del comprador en su visita (visit_slots.visitor_email por property_id + visitor_phone).
      3. INSERT offers: initiated_by='Buyer', status='Presented', amount, buyer_dni, buyer_email,
         buyer_name, buyer_phone, property_id  (NO salesforce_quote_id).
      4. reject_offers_below: si amount < properties.reject_offers_below → Hero AVISA
         ("puede que el propietario no la acepte") pero registra igual. Sin auto-rechazo.
      5. notifications: type='new_offer' para el CV (Realtime, ya cableado en la PWA).
      6. Email al equipo (hola@herohome.es): "nueva oferta de X€ en vivienda Y".
  → Hero confirma al PC que su oferta ha quedado registrada.
```

### 2.C — manage-offer (el CV decide, desde la PWA)

```
CV pulsa Aceptar / Rechazar / Contraoferta en la PWA
  → useOffers llama a Edge Function manage-offer  (YA NO escribe directo en la tabla)
      action=accept   → UPDATE offer status='Accepted'
      action=deny     → UPDATE offer status='Denied'
      action=counter  → UPDATE offer padre status='Denied'
                        + INSERT nueva offer: initiated_by='Owner', status='Presented',
                          amount, parent_offer_id  (NO salesforce_quote_id)
      En todos los casos:
        → avisa al PC: WhatsApp (plantilla) + email (Resend)
        → notifications type='offer_updated' para el CV (histórico)
        → email al equipo (hola@herohome.es)
```

- **Atómico:** la función hace el cambio en BD **y** el aviso. El navegador deja de tocar la tabla `offers`.
- **Elimina** el `salesforce_quote_id = PWA_${uuid}` que hoy mete `counterOffer`.

### 2.D — Negociación (contraoferta multi-vuelta)

```
CV contraoferta (2.C, action=counter) → nueva offer Owner ligada (parent_offer_id)
  → PC recibe EMAIL  ("te han hecho una contraoferta, revisa WhatsApp o escribe a hola@herohome.es")
  → PC recibe WhatsApp plantilla `contraoferta` ("el propietario contraoferta 300.000€:
     ¿la aceptas, la rechazas y cerramos, o haces una nueva oferta?")

PC responde por WhatsApp (texto libre) → Hero:
  ├─ Acepta            → respond_to_counteroffer('accept') → UPDATE offer Owner status='Accepted'
  ├─ Rechaza y cierra  → respond_to_counteroffer('reject') → UPDATE offer Owner status='Denied'
  └─ Nueva oferta      → create_offer(amount, …) → INSERT offer Buyer ligada (parent)

  En los 3 casos → EMAIL al propietario (CV) + notification offer_updated + email al equipo.
  Si fue "nueva oferta" → vuelve al CV en la PWA (2.C). Ciclo hasta Accepted o Denied.
```

- Una oferta puede quedar **`Accepted` por dos caminos**: el CV acepta la del PC en la PWA, **o** el PC acepta la contraoferta del CV en WhatsApp. Mismo final: avisos + email al equipo + arranque manual de arras.

---

## 3. Cambios de datos (migración — aplicar manual, MCP read-only)

`supabase/sql/2026-06-24-offers.sql` (nuevo):

```sql
-- offers: DNI + email del comprador
ALTER TABLE offers ADD COLUMN IF NOT EXISTS buyer_dni   text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS buyer_email text;

-- offers: salesforce_quote_id es legacy (Salesforce solo hasta la conversión).
-- Hoy es NOT NULL sin default → por eso el front metía 'PWA_<uuid>'. Lo soltamos.
ALTER TABLE offers ALTER COLUMN salesforce_quote_id DROP NOT NULL;

-- visit_slots: disparador post-visita (idempotencia) + feedback
ALTER TABLE visit_slots ADD COLUMN IF NOT EXISTS post_visit_sent_at  timestamptz;
ALTER TABLE visit_slots ADD COLUMN IF NOT EXISTS post_visit_outcome  text;  -- 'interested' | 'not_interested' | NULL
ALTER TABLE visit_slots ADD COLUMN IF NOT EXISTS post_visit_feedback text;  -- literal del visitante (raw)

-- (opcional) índice para el cron post-visita
CREATE INDEX IF NOT EXISTS idx_visit_slots_postvisit
  ON visit_slots (end_time)
  WHERE status = 'Confirmed' AND post_visit_sent_at IS NULL;
```

**Valores de status (recordatorio, PascalCase verificado):**
`offers.status` = `Presented` | `Accepted` | `Denied` · `offers.initiated_by` = `Buyer` | `Owner`.
`visit_slots.status` = `Available` | `Pending to confirm` | `Confirmed` | `Canceled by owner` | `Canceled by visitor` | `Not available` | `Completed`.

> Nota: `offers.salesforce_quote_id` / `visit_slots.salesforce_event_id` siguen existiendo como legacy nullable — **no escribir** en ellos (regla v3.1).

---

## 4. Edge Functions

| Función | Tipo | Estado | Notas |
|---|---|---|---|
| `post-visit-followup` | NUEVA (cron, x-api-key, verify_jwt=false) | ⬜ | Manda plantilla `post_visita`, marca `post_visit_sent_at`, persiste el mensaje en la conversación |
| `create-offer` | NUEVA (tool de whatsapp-agent, patrón request-visit-slot) | ⬜ | Verifica honorarios, INSERT oferta, notif CV, email equipo |
| `manage-offer` | NUEVA (POST desde PWA, verify_jwt=true) | ⬜ | accept/deny/counter + aviso PC (WhatsApp+email) + email equipo |
| `whatsapp-agent` | CAMBIOS | 🔧 | Tools nuevas + contexto del comprador + manejo respuesta a contraoferta + feedback post-visita |

**Cron nuevo** (`supabase/sql/setup-crons.sql`, CRON 5):
```
'post-visit-followup'  →  '*/30 * * * *'  → net.http_post a /functions/v1/post-visit-followup (x-api-key)
```

---

## 5. Hero (whatsapp-agent) — tools y contexto

**Contexto inyectado** (al cargar el turno, además de la propiedad ya existente). Se consulta por `property_id` (de la conversación) + `wa_phone_number`:
- **Visita reciente** del comprador (para ligar el feedback): `visit_slots` por property + visitor_phone, la más reciente `Confirmed`/`Completed`.
- **Ofertas vivas** del comprador: `offers` por property + buyer_phone con `status='Presented'` (especialmente una contraoferta `initiated_by='Owner'` pendiente de su respuesta).

> Esta pieza (Hero conoce el estado del comprador) se construye **una vez** y sirve para la contraoferta **y** para el feedback post-visita.

**Tools nuevas:**
- `create_offer(amount, dni)` — oferta del comprador (inicial o contra-contraoferta; liga `parent_offer_id` si hay negociación viva). Llama a la Edge Function `create-offer`.
- `respond_to_counteroffer(action: 'accept' | 'reject')` — responde a la contraoferta viva del propietario.
- `save_visit_feedback(outcome, feedback_text)` — guarda el motivo del "no" en `visit_slots` (raw).

**Guardarraíl:** mantener el anti-alucinación existente (no confirmar acciones sin éxito real de la tool). Modelo: `claude-sonnet-4-6`.

---

## 6. Plantillas Meta (es_ES, sin botones) — crear con antelación (lead time de aprobación)

| Nombre (sugerido) | Params | Borrador de copy |
|---|---|---|
| `post_visita` | {{1}} nombre, {{2}} dirección | "Hola {{1}} 👋 ¿Qué te ha parecido la visita a {{2}}? Si quieres hacer una oferta o tienes cualquier duda, escríbeme por aquí y te ayudo." |
| `oferta_aceptada` | {{1}} nombre, {{2}} importe, {{3}} dirección | "¡Enhorabuena {{1}}! 🎉 El propietario ha aceptado tu oferta de {{2}} por {{3}}. Nos pondremos en contacto contigo para los siguientes pasos (arras y firma)." |
| `oferta_no_aceptada` ⚠️ | {{1}} nombre, {{2}} dirección | "Hola {{1}} 👋 Te informamos de que el propietario no ha aceptado tu oferta por la vivienda de {{2}}. Sentimos no traerte mejores noticias" |
| `contraoferta` | {{1}} nombre, {{2}} importe, {{3}} dirección | "Hola {{1}}, el propietario ha hecho una contraoferta de {{2}} por {{3}}. ¿Quieres aceptarla, rechazarla y cerrar la negociación, o hacer una nueva oferta? Escríbeme por aquí." |

> Convención obligatoria: idioma **es_ES** (`send-whatsapp.ts` envía es_ES por defecto). Dentro de la ventana de 24h hay fallback a texto libre, pero el disparo proactivo siempre necesita plantilla aprobada.
>
> ⚠️ **La plantilla de rechazo debe ser categoría Utility/Servicio en Meta, nunca Marketing.** Las plantillas de Marketing sufren límites de frecuencia y filtrado de Meta y pueden **descartarse en silencio** fuera de la ventana de 24h. La antigua `oferta_rechazada` acabó recategorizada a Marketing por incluir un gancho de reenganche ("…puedes proponer una nueva oferta por aquí") y dejó de entregarse. Se sustituyó por **`oferta_no_aceptada`**, con texto puramente informativo (sin CTA), para que Meta la mantenga en Servicio. Regla general: **cero invitaciones a reofertar ni lenguaje persuasivo en las plantillas**; el reenganche se hace en conversación (texto libre) cuando el comprador responde. Meta recategoriza según el contenido y no permite forzar la categoría editando: si hay que cambiarla, se crea una plantilla **nueva** (nombre distinto, porque reutilizar el de una borrada queda bloqueado un tiempo) y se actualiza la constante `TEMPLATE_DENIED` en `manage-offer`.

---

## 7. Emails (Resend) a construir

Plantillas HTML nuevas en `supabase/functions/_shared/email-templates/` (branding Herohome, como las de visitas):

- **Al PC** — decisión sobre su oferta: `offerAcceptedPcHtml`, `offerDeniedPcHtml`, `offerCounterPcHtml` (la de contraoferta lo deriva a WhatsApp / hola@herohome.es).
- **Al CV** — cuando el PC responde a la contraoferta (acepta / rechaza / nueva oferta).
- **Al equipo** (hola@herohome.es) — alerta interina (sustituye al dashboard, B8) en **cada evento de oferta**: nueva oferta (PC o CV), aceptada, rechazada. Incluye vivienda, comprador, importe, teléfono.

---

## 8. Frontend (PWA)

- `src/hooks/useOffers.ts` — `acceptOffer` / `denyOffer` / `counterOffer` dejan de escribir directo en Supabase y pasan a **invocar `manage-offer`** (`edgeFunctions.ts`). Quitar el `salesforce_quote_id`.
- `OffersPage` — verificar que refleja estados y la negociación (cadena `parent_offer_id`). Notificaciones `new_offer` / `offer_updated` ya están cableadas (Realtime).

---

## 9. Orden de construcción sugerido (por piezas)

1. **Migración de BD** (sección 3) — base de todo.
2. **manage-offer + refactor `useOffers`** — el CV decide y el PC se entera (WhatsApp+email) + email equipo. Requiere plantillas `oferta_aceptada` / `oferta_no_aceptada` / `contraoferta`.
3. **create-offer + tool en Hero + contexto del comprador** — el PC oferta por WhatsApp (gate honorarios + email equipo).
4. **Respuesta del PC a la contraoferta** (`respond_to_counteroffer`) — cierra el ciclo de negociación.
5. **Post-visita** (cron + `post-visit-followup` + plantilla `post_visita` + Hero toma riendas + feedback). Requiere que 3 ya exista (a dónde llevar al PC).
6. **Actualizar docs** (CLAUDE.md + arquitectura: B11 fuera de aplazados, estado B9) + sesión de registro.

> Las **plantillas Meta** (sección 6) conviene darlas de alta en cuanto empecemos la pieza 2 (lead time de aprobación).

---

## 10. Decisiones cerradas (resumen)

- Post-visita ~1h después, **plantilla sin botones**, cron cada 30 min, sin ventana horaria.
- `create_offer` captura **importe + DNI** y nada más (el resto de datos de arras los pide el humano por teléfono y los anota en Salesforce manualmente tras aceptar).
- Honorarios: `create_offer` **verifica** el consentimiento; si falta (raro), reutiliza el gate existente. No se complica.
- `reject_offers_below`: **sin auto-rechazo**; Hero avisa pero registra.
- `manage-offer`: **opción 1** (función hace UPDATE + aviso; el front deja de escribir directo).
- Contraoferta: **ciclo completo multi-vuelta** PC↔CV.
- Feedback "no me interesa": se recoge en `visit_slots` (`post_visit_outcome` + `post_visit_feedback`); Hero **sintetiza** el motivo (no necesariamente literal).
- Email al equipo (hola@herohome.es) en **cada evento** de oferta, como interim del dashboard (B8 sigue aplazado).

### Robustez (endurecido tras incidencia de jul-2026)

- **Anti-duplicado en `create-offer`:** una oferta nueva del comprador **cierra (`Denied`) su oferta previa en `Presented`** sobre la misma vivienda. Antes no había control y una doble llamada del agente (o una oferta nueva) dejaba dos ofertas activas del mismo comprador a la vez.
- **`manage-offer` deja rastro en el panel:** tras avisar al comprador, registra una nota del sistema en `whatsapp_conversations` (rol `assistant`). Antes `manage-offer` enviaba plantilla + email pero **no** escribía en la conversación, así que el aviso de oferta era invisible en admin.
- **Fin del fallo silencioso:** si el WhatsApp al comprador no se entrega, el email interino al equipo lo resalta en el asunto (`⚠️ WhatsApp no entregado`) y con una nota, indicando si al menos llegó el email o si hay que contactar a mano. Antes un fallo de entrega solo quedaba en un `console.error`.

# ARCHITECTURE_V3_DECISIONS.md

> **Este archivo es la referencia autoritativa para Claude Code.**
> La arquitectura vigente es la **v3.1** (12 junio 2026). Cualquier referencia en el código, comentarios o documentación a Edge Functions, Salesforce Flows, escenarios de Make o integraciones que aparezcan como "ELIMINADAS" en este documento debe ignorarse o eliminarse.
> La v3.1 no cambia el principio de la v3.0 (Supabase como sistema operativo); cambia **dónde vive el agente de WhatsApp** (Edge Function, no Make) y **por dónde salen los emails** (Resend, no Gmail vía Make).

---

## Principios arquitectónicos v3.1

1. **Salesforce es el sistema de registro legal y contractual — y está CONGELADO.** Ninguna funcionalidad nueva entra en Salesforce. Su rol queda limitado a: Leads → conversión → botón "Enviar acceso PWA" (Flow 1) → contratos y firma (Docs/Sign Made Easy). Criterio de diseño para cualquier propuesta: *"¿podría borrarse Salesforce en 2027 sin reescribir nada más?"* Si la respuesta es no, la propuesta es incorrecta.
2. **Supabase es el sistema operativo de la venta.** Fuente de verdad para visitas, ofertas, propiedades (operativo), conversaciones, notificaciones y consentimientos. Los datos fluyen SF → Supabase **una sola vez** (Flow 1 → `create-user`). No existen integraciones bidireccionales.
3. **Toda la lógica de negocio vive en Edge Functions.** Incluido el agente conversacional de WhatsApp. La PWA solo hace fetch.
4. **Resend es el único canal de email transaccional** (CV y PC). Las plantillas HTML viven en el código de las Edge Functions.
5. **Make queda reducido a lo insustituible:** el trigger de Gmail para los emails de Idealista (Escenario 2) y el formulario web → Lead SF (Escenario 1). Nada más.

---

## Cambios de v3.0 a v3.1

### 1. AGENTE WHATSAPP — Vive en una Edge Function, NO en Make

**v3.0 (OBSOLETO):** webhook de Meta → Make → escenario con agente GPT-4o → Edge Functions.

**v3.1 (VIGENTE):**

```
Webhook de Meta (mensajes entrantes WhatsApp)
  → Edge Function whatsapp-agent
      1. GET: responde al hub.challenge de verificación de Meta
      2. POST: valida firma HMAC X-Hub-Signature-256 (META_APP_SECRET)
      3. Recupera historial (get-conversation-history / tabla whatsapp_conversations)
      4. Loop de tool calling con Claude Sonnet 4.6 (Anthropic API)
      5. Tools v1: get_available_slots, request_visit
         Tools v2 (B6/B9): cancel_visit_by_visitor, create_offer
      6. Persiste mensajes (save-message)
      7. Responde al PC vía WhatsApp Cloud API
```

Razones: Make no tiene bucle nativo de tool calling; consume 5-10 operaciones por mensaje; no permite validar la firma HMAC de Meta (endpoint falsificable); el código es testeable y mantenible por Claude Code, la GUI de Make no.

**El escenario de Make que recibía el webhook de WhatsApp queda DESACTIVADO.** Si encuentras referencias a "agente en Make", elimínalas.

### 2. EMAILS — Resend para todo, Make/Gmail eliminado

| Tipo de email | Destinatario | v3.0 (OBSOLETO) | v3.1 (VIGENTE) |
|---|---|---|---|
| Bienvenida + Magic Link | CV | Edge Function + Resend | Sin cambios |
| Confirmación/cancelación visita | PC | notify-visit → webhook Make → Gmail | **notify-visit → Resend + WhatsApp Cloud API directo** |
| Recordatorio 24h | CV + PC | visit-reminders → webhook Make → Gmail | **visit-reminders → Resend directo** |
| Decisión sobre oferta | PC | manage-offer → webhook Make → Gmail | **manage-offer → Resend + WhatsApp directo** |
| Post-visita / feedback | PC | complete-visits → webhook Make → Gmail | **post-visit-followup → WhatsApp directo (B9): follow-up ~1h + feedback** |

- Los **Escenarios 3, 4, 5 y 6 de Make están ELIMINADOS**. El Escenario 3 (activo en v3.0) se desactiva cuando se despliegue `notify-visit` v3.1.
- El secret `MAKE_WEBHOOK_NOTIFY_VISIT` queda obsoleto tras la reescritura de `notify-visit`: eliminarlo.
- Las plantillas HTML de email viven embebidas en el código (branding según DESIGN.md), no en Make.

### 3. LEADS DE IDEALISTA — Parsing con LLM, no regex

**v3.1 (VIGENTE):**

```
Email de Idealista llega a Gmail
  → Make Escenario 2 (SOLO 2 módulos): Gmail Watch → HTTP POST
    → Edge Function process-idealista-lead
        1. Extrae teléfono/nombre/referencia con LLM barato (salida JSON estructurada)
        2. Lookup de la propiedad en Supabase
        3. Envía plantilla WhatsApp de bienvenida al PC
        4. Si la extracción falla → email de alerta (Resend) al agente Herohome
```

No usar regex para el parsing: Idealista cambia plantillas sin avisar y los regex se rompen en silencio. La alerta de fallo es obligatoria.

### 4. SALESFORCE — Congelado (refuerza v3.0)

Se mantienen las eliminaciones de v3.0 (sin Events, sin Quotes, sin sync de propiedad) y se añade: **no desarrollar nada nuevo en Salesforce** — ni campos, ni Flows, ni Apex. Lo que existe se mantiene; lo que falta se construye en Supabase. En Fase 2 se evaluará migrar onboarding y firma fuera de SF.

### 5. ALCANCE FASE 1 — Camino crítico a la primera transacción

**Secuencia:** B5 (agente + visitas) → B6/B7 (reagendados + recordatorios) → B9 (ofertas) → B12 (QA y lanzamiento).

**APLAZADO post-lanzamiento — NO desarrollar hasta tener operaciones reales:**

| Bloque | Componente | Interim |
|---|---|---|
| B8 | Dashboard de Operaciones (app completa) | Table Editor de Supabase + 3-4 vistas SQL guardadas |

> **B10 (chat Hero en la PWA) se adelantó y completó** (25 junio, retrasando B12): `chat-with-hero` ayuda al CV a gestionar su venta (consultar visitas/ofertas/disponibilidad, confirmar/cancelar visitas, bloquear huecos). Hermano de `whatsapp-agent`. Ya no está aplazado.
> **B11 (post-visita) se adelantó e integró en B9** (el comprador no sabría cómo ofertar sin un empujón tras la visita): `post-visit-followup` + recogida de feedback. Ya no está aplazado.

### 6. DNI DEL PC — Se captura en la oferta, no antes de la visita

El flujo RGPD del agente de WhatsApp pide consentimiento de privacidad al inicio, pero el DNI **solo se solicita en el momento de formalizar una oferta** (tool `create_offer`), no antes de la visita. Reduce fricción del funnel. La tool `create_offer` incluye además un gate: no se registra oferta sin el reconocimiento de honorarios del comprador firmado (definición legal en curso, bloque B13 del plan).

### 7. OFERTAS Y VISITAS — Sin cambios de fondo respecto a v3.0

- `offers` y `visit_slots` en Supabase son la única fuente de verdad. Sin Quotes ni Events en SF.
- `salesforce_quote_id` y `salesforce_event_id` son legacy nullable: no escribir en ellos.
- `create_offer` pasa de ser "Edge Function llamada desde Make" a ser **tool del loop de whatsapp-agent** (puede implementarse como módulo interno o función separada invocada por el agente).
- manage-offer: misma lógica v3.0 (accepted / denied / contraoferta con nueva fila e initiated_by = 'Owner'), pero notifica por Resend + WhatsApp directamente.

### 8. INFRAESTRUCTURA DE DESARROLLO (B14 — completado 12 junio 2026)

- **Supabase MCP conectado en Claude Code** (servidor remoto `mcp.supabase.com`, scoped a `project_ref=zqkvcphtqmibttgnivku`, **read_only=true**). Claude Code puede leer esquema y datos. Las escrituras (migraciones, crons) se generan como SQL y las aplica el humano, salvo decisión explícita de quitar read-only bajo supervisión. **El proyecto es PRODUCCIÓN: no hay staging.**
- **GitHub Action de deploy** (`.github/workflows/deploy.yml`): push a `main` con cambios en `supabase/functions/**` → `supabase functions deploy`. Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`.
- Pendiente de revisión técnica: asegurar `verify_jwt = false` en el `config.toml` de las funciones que se invocan con `x-api-key` (no con JWT de usuario), para que el deploy automático no reactive la verificación JWT.

---

## Edge Functions — Estado v3.1

| Edge Function | Trigger | Estado v3.1 |
|---|---|---|
| `create-user` | HTTP POST desde SF Flow 1 | ✅ Completada |
| `send-welcome-email` | Interna desde create-user | ✅ Completada |
| `generate-slots` | Cron diario 03:00 UTC + on-save (PWA) | ✅ v3.1: sincroniza ventana móvil de 14 días (idempotente) |
| `cleanup-slots` | Cron diario 02:00 | ✅ Completada |
| `get-available-slots` | Tool del agente / HTTP GET | ✅ Completada (pasa a ser tool de whatsapp-agent) |
| `request-visit-slot` | Tool del agente / HTTP POST | ✅ Completada (pasa a ser tool de whatsapp-agent) |
| `get-conversation-history` | Interna desde whatsapp-agent | ✅ Completada |
| `save-message` | Interna desde whatsapp-agent | ✅ Completada |
| `notify-visit` | HTTP POST desde PWA | ✅ Reescrita v3.1 (B5): Resend + WhatsApp directo al PC, sin webhook Make |
| `whatsapp-agent` | **Webhook de Meta (GET verificación + POST mensajes)** | ✅ Desplegada (B5, verify_jwt=false) — pendiente conectar webhook en Meta |
| `process-idealista-lead` | HTTP POST desde Make Esc. 2 | ✅ Desplegada (B5, verify_jwt=false) — pendiente reconfigurar Make Escenario 2 |
| `cancel-visit-by-visitor` | Tool del agente | ✅ Completada (B6): cancela + notifica al CV (Realtime) |
| `visit-reminders` | Cron diario 07:00 UTC (x-api-key, verify_jwt=false) | ✅ Completada (B7): recordatorio el día antes — WhatsApp `recordatorio_visita` + email al PC, email al CV |
| `manage-offer` | HTTP POST desde PWA | ✅ B9 (código): accept/deny/counter + Resend + WhatsApp directo |
| `create-offer` | Tool del agente | ✅ B9 (código): oferta del PC (importe+DNI) + verifica honorarios |
| `respond-counteroffer` | Tool del agente | ✅ B9 (código): PC acepta/rechaza la contraoferta del CV |
| `post-visit-followup` | Cron cada 30 min | ✅ B9 (código): post-visita ~1h después (B11 integrado) |
| `save-visit-feedback` | Tool del agente | ✅ B9 (código): feedback del PC en la visita |
| `complete-visits` | Cron diario 23:00 (SQL inline) | ✅ Existe en setup-crons.sql |
| `chat-with-hero` | HTTP POST desde PWA (JWT del CV) | ✅ B10 validado e2e (25 jun): agente Hero del propietario |
| `manage-visit` | HTTP POST: PWA (JWT) o Hero (x-api-key) | ✅ B10: confirmar/cancelar visita del CV + notify-visit (fuente única front+Hero) |
| `block-visit-slots` | Tool de chat-with-hero (x-api-key) | ✅ B10: bloquea Available→Not available en un rango |

### Secrets de Supabase (estado objetivo v3.1)
- `RESEND_API_KEY` (rotar: tarea B12)
- `PWA_BASE_URL`
- `ANTHROPIC_API_KEY` (nuevo — whatsapp-agent → `claude-sonnet-4-6`; process-idealista-lead → `claude-haiku-4-5`)
- `META_APP_SECRET` (nuevo — validación HMAC del webhook)
- `WHATSAPP_VERIFY_TOKEN` (nuevo — string propio elegido por nosotros, para la verificación GET del webhook de Meta)
- `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` (envío Cloud API)
- `WHATSAPP_WELCOME_TEMPLATE_NAME` (nuevo — nombre de la plantilla de bienvenida aprobada en Meta, usada por process-idealista-lead; por defecto `bienvenida_pc`)
- ~~`MAKE_WEBHOOK_NOTIFY_VISIT`~~ — ELIMINAR tras reescribir notify-visit

---

## Make.com — Estado v3.1

| # | Escenario | Estado v3.1 |
|---|---|---|
| 1 | Formulario web → Lead en Salesforce | ✅ Activo (se mantiene) |
| 2 | Gmail Watch (Idealista) → HTTP a process-idealista-lead | 🔄 Reconfigurar: SOLO 2 módulos |
| 3 | Notificación visita → Gmail | ❌ ELIMINADO (desactivar al desplegar notify-visit v3.1) |
| 4 | Recordatorio 24h → Gmail | ❌ ELIMINADO (nunca construir) |
| 5 | Decisión oferta → Gmail | ❌ ELIMINADO (nunca construir) |
| 6 | Post-visita → Gmail + WhatsApp | ❌ ELIMINADO (nunca construir) |
| — | Webhook WhatsApp entrante | ❌ ELIMINADO (el webhook de Meta apunta a whatsapp-agent) |

---

## Fuente de verdad por entidad (sin cambios respecto a v3.0)

| Dato | Sistema maestro |
|---|---|
| Datos de vivienda (iniciales) | Salesforce Account → copia única a Supabase |
| Datos de vivienda (operativos) | Supabase `properties` |
| Visitas | Supabase `visit_slots` |
| Ofertas | Supabase `offers` |
| Datos del CV | Salesforce Contact → copia única a Supabase |
| Leads y captación | Salesforce Lead |
| Contratos y firma | Salesforce + Docs/Sign Made Easy |
| Conversaciones PWA | Supabase `pwa_chat_sessions` |
| Conversaciones WhatsApp | Supabase `whatsapp_conversations` |
| Consentimientos RGPD | Supabase `consents` |

---

## Reglas para Claude Code (v3.1)

1. **NO crear** Edge Functions de sincronización con Salesforce (`confirm-visit-to-sf`, `update-offer-to-sf`, `sync-offer-from-sf`, `update-property-to-sf`). Obsoletas desde v3.0.
2. **NO desarrollar nada nuevo en Salesforce** (congelado v3.1): ni campos, ni Flows, ni Apex.
3. **NO proponer escenarios de Make** para notificaciones, agente conversacional ni lógica de negocio. Make = solo Escenarios 1 y 2.
4. **Todo email transaccional sale por Resend** desde Edge Functions, con plantillas HTML embebidas en el código. Nunca por Gmail/Make.
5. El agente de WhatsApp vive en la Edge Function `whatsapp-agent`. El webhook de Meta apunta a ella. Validar SIEMPRE la firma HMAC en POST y responder al hub.challenge en GET.
6. **NO escribir** en `salesforce_event_id` (visit_slots) ni `salesforce_quote_id` (offers).
7. **NO construir** B8 (Dashboard) hasta el post-lanzamiento. (B10 chat PWA y B11 post-visita se adelantaron y completaron.)
   - **Agentes de Hero:** lecturas directas a BD; **escrituras SIEMPRE vía Edge Function**. Aislamiento por el `user_id` del JWT verificado, nunca por ids del cliente. `chat-with-hero` (CV) es hermano de `whatsapp-agent` (PC) — ver `docs/AGENT.md`.
8. El DNI del PC se solicita en `create_offer`, no antes de la visita.
9. Parsing de emails de Idealista: con LLM y salida JSON + alerta de fallo. Nunca regex.
10. El MCP de Supabase está en read-only: generar SQL de migraciones/crons para aplicación manual, salvo instrucción explícita en contrario.
11. Valores de status en BD: usar EXACTAMENTE los documentados en CLAUDE.md (PascalCase verificado contra la BD). Ignorar cualquier documento que los liste en minúsculas.

# Herohome PWA — Contexto para Claude Code

> Este archivo se carga automáticamente al inicio de cada sesión.
> Actualizar al final de cada sesión y hacer push a GitHub.
> **Arquitectura vigente: v3.1** — leer `ARCHITECTURE_V3_DECISIONS.md` antes de proponer funcionalidades o Edge Functions.

---

## Qué es Herohome

Herohome es la primera agencia inmobiliaria 100% digital de España. Propietarios venden su vivienda asistidos por un agente IA llamado **Hero**. Comisión: 1% al vendedor + 1% al comprador (pricing en revisión — bloque B13 del plan). Web corporativa: herohome.es (en migración de Webflow a Vercel).

**Naming:** Herohome (nunca HeroHome ni HEROHOME). El agente IA se llama Hero (nunca "el bot" ni "la IA").

---

## Actores del sistema

- **CV** (Cliente Vendedor): propietario con contrato. Accede a la PWA.
- **PC** (Prospecto Comprador): interesado en comprar. Solo interactúa vía WhatsApp.
- **PV** (Prospecto Vendedor): sin contrato. No accede a la PWA.
- **Hero**: agente IA (Claude Sonnet 4.6, Anthropic API). Dos instancias en vivo: Agente WhatsApp (`whatsapp-agent`, habla con el PC) y Agente PWA (`chat-with-hero`, habla con el CV — B10, 25 junio). Diseño documentado en `docs/AGENT.md`.
- **Agente Herohome**: persona humana para tareas no automatizables. Opera con el Table Editor de Supabase + vistas SQL (el Dashboard completo está aplazado, B8).

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| PWA Frontend (CV) | React 18 + Vite + TypeScript + Tailwind CSS — **este repo** |
| Backend / BD / Lógica | Supabase (PostgreSQL + Auth + Edge Functions + Cron) |
| Agente WhatsApp | Edge Function `whatsapp-agent` (Claude Sonnet 4.6, tool calling) — ver `docs/AGENT.md` |
| CRM | Salesforce Enterprise + Docs/Sign Made Easy — **CONGELADO: no añadir nada** |
| Email transaccional (CV y PC) | Resend desde Edge Functions (plantillas HTML en código) |
| Make.com | SOLO: Esc. 1 (form web → Lead SF) y Esc. 2 (Gmail Idealista → Edge Function) |
| WhatsApp | WhatsApp Cloud API (Meta) — webhook apunta a `whatsapp-agent` |
| IA | Anthropic API — agente WhatsApp `claude-sonnet-4-6`; extracción Idealista `claude-haiku-4-5` |
| Hosting | Vercel (auto-deploy desde GitHub) |
| Dashboard Operaciones | APLAZADO (B8) — interim: Supabase Table Editor + vistas SQL |

---

## Arquitectura v3.1 — Reglas que Claude Code DEBE respetar

- **Salesforce está CONGELADO.** No crear campos, Flows ni Apex. Su único rol: Leads → Flow 1 (botón "Enviar acceso PWA") → contratos/firma.
- **NO crear** Edge Functions de sync con Salesforce (`update-property-to-sf`, `update-offer-to-sf`, `confirm-visit-to-sf`, `sync-offer-from-sf`) — eliminadas en v3.0.
- **NO escribir** en `salesforce_event_id` (visit_slots) ni `salesforce_quote_id` (offers) — legacy nullable.
- **Todo email sale por Resend** desde Edge Functions. Los webhooks a Make para notificaciones están ELIMINADOS (Escenarios 3-6 de Make no existen en v3.1).
- El agente de WhatsApp vive en `whatsapp-agent` (Edge Function), NO en Make. Validar firma HMAC de Meta en cada POST.
- **NO construir** B8 (Dashboard) hasta el post-lanzamiento. B10 (chat Hero PWA, `chat-with-hero`) construido y validado e2e (25 junio). B11 (post-visita) se adelantó e integró en B9.
- **Acciones del agente de Hero:** lecturas directas a BD; **escrituras SIEMPRE vía Edge Function** (convención del proyecto). El aislamiento se garantiza filtrando por el `user_id` del JWT verificado, nunca por ids del cliente.
- DNI del PC: se pide en `create_offer`, no antes de la visita.
- Parsing de Idealista: LLM con salida JSON + alerta de fallo. Nunca regex.
- UI en **español**. Mobile-first (375px primero).
- Diseño: Inter como fuente. Color primario **#5B5CFF**. Sin box-shadows (usar bordes). Estética Stripe/Linear. Ver DESIGN.md.

---

## Supabase

- **URL:** `https://zqkvcphtqmibttgnivku.supabase.co` — **ES PRODUCCIÓN, no hay staging**
- **Anon key:** en `.env` como `VITE_SUPABASE_ANON_KEY`
- **Auth:** Magic Link (email). Sesiones de 7 días.
- **RLS:** activado. Cada usuario solo ve sus propios datos.
- NUNCA usar la Service Role Key en el cliente.
- **MCP de Supabase conectado en Claude Code** (read-only, scoped a este proyecto): usarlo para leer esquema, datos y razonar sobre RLS. Las escrituras (migraciones, crons) se entregan como SQL para aplicación manual, salvo instrucción explícita del usuario.

### Valores de status en BD (verificados contra la BD — PascalCase)

**`visit_slots.status`** (sin check constraint):
`Available` | `Pending to confirm` | `Confirmed` | `Canceled by owner` | `Canceled by visitor` | `Not available` | `Completed`

**`offers.status`** (check constraint): `Presented` | `Accepted` | `Denied`

**`offers.initiated_by`** (check constraint): `Buyer` | `Owner`

> ⚠️ Cualquier documento que liste estos valores en minúsculas/snake_case es obsoleto.

---

## Deploy — Pipeline automático

- **PWA:** push a GitHub → Vercel redespliega automáticamente.
- **Edge Functions:** push a `main` con cambios en `supabase/functions/**` → GitHub Action (`.github/workflows/deploy.yml`) ejecuta `supabase functions deploy`. Secrets del repo: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`.
- **`config.toml`** presente en `supabase/config.toml`: fija `verify_jwt = false` para `whatsapp-agent`, `process-idealista-lead`, `visit-reminders` y `generate-slots`.
- **Deploy manual (fallback):** `supabase functions deploy <nombre-función>`

---

## Commands

```
npm run dev      # servidor de desarrollo (puerto 5173)
npm run build    # build de producción
npm run lint     # ESLint
```

---

## Arquitectura del código

```
src/
├── components/   # Modal, Toast, Toggle
├── pages/        # LoginPage, HomePage (chat), PropertyPage, CalendarPage, OffersPage
├── layouts/      # MainLayout (header + sidebar + notificaciones)
├── hooks/        # useAuth, useProperty, useVisits, useOffers, useChatSession,
│                 # useNotifications, useAvailability
├── lib/          # supabaseClient.ts, types.ts, edgeFunctions.ts
├── context/      # AuthContext
└── main.tsx      # Router + AuthProvider
```

### Code style
- TypeScript strict, no `any`
- Named exports (excepto páginas para lazy loading)
- Tailwind utility classes, sin CSS custom
- Hooks para lógica de datos, componentes para UI
- PascalCase para componentes, camelCase para hooks/utils

---

## Edge Functions de Supabase

| Función | Trigger | Estado |
|---------|---------|--------|
| `create-user` | HTTP POST desde Salesforce Flow 1 | ✅ Completada |
| `send-welcome-email` | Interna desde create-user | ✅ Completada |
| `generate-slots` | Cron diario 03:00 UTC + on-save (PWA) | ✅ v3.1: sincroniza ventana móvil de 14 días (idempotente) |
| `cleanup-slots` | Cron diario 02:00 | ✅ Completada |
| `get-available-slots` | Tool de whatsapp-agent | ✅ Completada |
| `request-visit-slot` | Tool de whatsapp-agent | ✅ Completada |
| `get-conversation-history` | Interna desde whatsapp-agent | ✅ Completada |
| `save-message` | Interna desde whatsapp-agent | ✅ Completada |
| `notify-visit` | HTTP POST desde PWA | ✅ Reescrita v3.1 (B5): Resend + WhatsApp directo al PC, sin Make |
| `whatsapp-agent` | Webhook de Meta (GET + POST con HMAC) | ✅ EN VIVO (B5, verify_jwt=false) — webhook conectado y chat entrante probado |
| `process-idealista-lead` | HTTP POST desde Make Esc. 2 | ✅ Desplegada (B5, verify_jwt=false) — pendiente reconfigurar Make Esc. 2 |
| `cancel-visit-by-visitor` | Tool de whatsapp-agent | ✅ Completada (B6): cancela (status → Canceled by visitor) + notifica al CV |
| `visit-reminders` | Cron diario 07:00 UTC (x-api-key) | ✅ B7: recordatorio el día antes (WhatsApp+email PC, email CV) |
| `manage-offer` | HTTP POST desde PWA | ✅ B9 validado e2e: accept/deny/counter + aviso PC/equipo |
| `create-offer` | Tool de whatsapp-agent | ✅ B9 validado e2e: oferta del PC (importe+DNI) + verifica honorarios + avisa CV/equipo |
| `respond-counteroffer` | Tool de whatsapp-agent | ✅ B9 validado e2e: el PC acepta/rechaza la contraoferta del CV |
| `post-visit-followup` | Cron cada 30 min | ✅ B9 validado e2e: post-visita ~1h después (`post_visita`); coge Confirmed + Completed |
| `save-visit-feedback` | Tool de whatsapp-agent | ✅ B9 validado e2e: guarda outcome + feedback (Hero lo sintetiza) en la visita |
| `complete-visits` | Cron diario 23:00 (SQL inline en setup-crons.sql) | ✅ Existe: marca Confirmed→Completed |
| `chat-with-hero` | HTTP POST desde PWA (JWT del CV) | ✅ B10 validado e2e (25 jun): agente Hero del propietario (Sonnet 4.6, 6 tools) |
| `manage-visit` | HTTP POST: PWA (JWT) o Hero (x-api-key) | ✅ B10: confirmar/cancelar visita del CV (check propiedad) + notify-visit. Fuente única (front + Hero) |
| `block-visit-slots` | Tool de chat-with-hero (x-api-key) | ✅ B10: bloquea Available→Not available en un rango (TZ Madrid) |

### Secrets de Supabase (estado objetivo v3.1)
- `RESEND_API_KEY` (pendiente rotación, B12)
- `PWA_BASE_URL` (`https://app.herohome.es`)
- `ANTHROPIC_API_KEY` — NUEVO (whatsapp-agent → `claude-sonnet-4-6`; process-idealista-lead → `claude-haiku-4-5`)
- `META_APP_SECRET` — NUEVO (validación HMAC)
- `WHATSAPP_VERIFY_TOKEN` — NUEVO (verificación GET del webhook de Meta, string propio)
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — envío Cloud API
- `WHATSAPP_WELCOME_TEMPLATE_NAME` — NUEVO (plantilla de bienvenida aprobada en Meta; por defecto `bienvenida_pc`)
- ~~`MAKE_WEBHOOK_NOTIFY_VISIT`~~ — ELIMINAR (notify-visit v3.1 ya no lo usa)
- ~~`OPENAI_API_KEY`~~ — ELIMINAR (nunca usado en v3.1)

---

## Make.com — Escenarios (v3.1)

| # | Escenario | Estado |
|---|-----------|--------|
| 1 | Formulario web → Lead en Salesforce | ✅ Activo |
| 2 | Gmail Watch (Idealista) → HTTP a process-idealista-lead (2 módulos) | ✅ Configurado (B5) — pendiente: prueba con primer email real de Idealista |
| 3-6 | Notificaciones vía Gmail | ❌ ELIMINADOS en v3.1 — desactivar Esc. 3 si aún está activo |
| — | Webhook WhatsApp entrante en Make | ❌ ELIMINADO: el webhook de Meta apunta a whatsapp-agent |

---

## Estado del proyecto (actualizado 25 junio 2026 — plan v3.1)

**B0-B4 — Fundamentos, Activación CV, PWA, Edición, Slots: ✅ COMPLETADOS**
- ✅ Bug del Magic Link (route guard + Service Worker stale) resuelto 14 junio 2026 — ver Registro de sesiones.

**B5 — Agente WhatsApp + Visitas: ✅ COMPLETADO y validado e2e (22 junio)**
- ✅ `whatsapp-agent` en vivo (webhook Meta + HMAC + loop Claude Sonnet 4.6 + tools `get_available_slots`/`request_visit` + guardarraíl anti-alucinación).
- ✅ `process-idealista-lead` desplegada (extracción Claude Haiku 4.5 + lookup + `bienvenida_pc` + alerta Resend). Make Esc. 2 configurado.
- ✅ `notify-visit` reescrita v3.1: Resend + WhatsApp directo (sin Make). Templates `visita_confirmada`/`visita_cancelada` aprobadas en es_ES.
- ✅ Email obligatorio en reserva. URL RGPD actualizada. Flujo Idealista→chat→reserva→confirmación→WhatsApp+email validado.
- Único pendiente: **primer email real de Idealista** (prueba Make Esc. 2 con email real, no simulado).

**B6 — Reagendado PC: ✅ COMPLETADO y validado e2e (23 junio)**
- ✅ Tool `cancel_visit_by_visitor` + Edge Function `cancel-visit-by-visitor` (cancela solo visitas propias por teléfono, status → `Canceled by visitor`).
- ✅ Aviso al CV: notificación in-app `visit_canceled` (PWA por Realtime) **+ email al propietario** (Resend) cuando la visita cancelada estaba en `Confirmed`.
- ✅ Lógica del agente: tras cancelar ofrece reagendar (reutiliza `get_available_slots`); reagendar = cancelar 1 vez + reservar (sin re-cancelar).
- ✅ Validado e2e por WhatsApp: reservar → confirmar → cancelar por PC → reagendar → confirmar, con notificaciones y emails. Requirió agente en **Sonnet 4.6** + guardarraíl anti-alucinación + reset de historial contaminado.
**B7 — Reagendado CV + Recordatorios: ✅ COMPLETADO y validado e2e (23 junio)**
- ✅ Próximas visitas + validación 24h en PWA: hecho en B5.
- ✅ Cancelación por propietario + aviso al PC (vía `notify-visit`): hecho y validado en B5.
- ✅ Edge Function `visit-reminders` (verify_jwt=false, x-api-key): cron `0 7 * * *` → recordatorio el día antes de visitas `Confirmed` (PC: plantilla `recordatorio_visita` WhatsApp + email; CV: email). Plantilla aprobada (es_ES), cron activo. **Validado e2e**: visita sembrada para mañana → llegaron WhatsApp + email al PC y email al CV.
- ✅ De paso, arreglado el cron `generate-daily-slots` (pasó a x-api-key; antes daba 401 con Bearer service_role).
**B9 — Gestión de Ofertas + post-visita: ✅ COMPLETADO y VALIDADO E2E (25 junio)**
- `manage-offer` (CV decide), `create-offer` (PC oferta, DNI), `respond-counteroffer` (PC responde a la contraoferta), `post-visit-followup` (cron post-visita) y `save-visit-feedback`. Hero con 6 tools.
- B11 (post-visita) integrado aquí — ya NO está aplazado.
- Desplegado, privacy SQL aplicada, cron registrado y ciclo completo validado e2e. Pendiente operativo: Meta a modo Live.

**B10 — Chat de Hero en la PWA (asistente del CV): ✅ COMPLETADO y VALIDADO E2E (25 junio)** — adelantado (retrasando B12).
- `chat-with-hero` (Sonnet 4.6, hermano de `whatsapp-agent`): auth JWT del CV → vivienda; 6 tools. Lectura: `get_visits`, `get_offers`, `get_availability` (reusa `get-available-slots`). Acción: `confirm_visit`/`cancel_visit` (vía `manage-visit`, regla 24h en Hero) y `block_slots` (vía `block-visit-slots`). Guardarraíl anti-alucinación acotado a afirmaciones en 1ª persona. Límites: ofertas → sección Ofertas; consejo de oferta / dudas → asesor (Google Calendar + email); disponibilidad recurrente → sección Disponibilidad.
- Nuevas Edge Functions: `manage-visit` (doble auth, fuente única front+Hero) y `block-visit-slots`. `useVisits` del front refactorizado para pasar por `manage-visit`.
- Validado e2e por el usuario desde la PWA. Diseño en `docs/AGENT.md` §9.

**Pendiente operacional antes del lanzamiento (no código):**
- ⚠️ **Meta → modo Live** (CRÍTICO): la app de Meta está en modo Desarrollo. Solo números de prueba autorizados reciben WhatsApp. Hasta activar "Live mode" (verificación de empresa), compradores reales no recibirán nada. Requiere: completar Business Verification en Meta + solicitar Live mode.
- 🔄 **Make Esc. 2**: probar con el primer email real de Idealista (función validada vía curl; el trigger Gmail no se ha probado con email real).
- 🧹 **Limpieza opcional** (no bloqueante): (a) borrar datos de prueba (visitas/conversaciones de Roberto y Carlos en vivienda Santander + slot "mañana" del test de B7); (b) eliminar secret `MAKE_WEBHOOK_NOTIFY_VISIT` (obsoleto en v3.1); (c) desactivar/eliminar escenario Make `whatsapp-herohome-inbound` (obsoleto v3.0); (d) eliminar secret `OPENAI_API_KEY` (nunca se usó en v3.1).

**B12 — QA y Lanzamiento: ⬜ PENDIENTE** (RLS, rotación de secrets, pen test incl. HMAC, monitoring)

**B13 — Negocio y Legal: 🔄 EN CURSO (paralelo, no técnico)**
- Revisión pricing "primera venta gratis" · contrato reconocimiento honorarios comprador (abogado) · momento de firma · plan de captación.
- ✅ (técnico, 24 junio — **desplegado y validado e2e**) Gate de reconocimiento de honorarios del comprador **antes de confirmar visita** en `whatsapp-agent` (estado `awaiting_fee_consent` + `recordFeeConsent`, determinista; % configurable por vivienda `properties.buyer_fee_percent`). Ver Registro de sesiones.

**B14 — Infraestructura de desarrollo: ✅ COMPLETADO (12 junio 2026)**
- ✅ Supabase MCP conectado en Claude Code (read-only, scoped al proyecto).
- ✅ GitHub Action de deploy verificado + filtro `paths` añadido. Secrets limpiados.
- ✅ CLAUDE.md y ARCHITECTURE_V3_DECISIONS.md actualizados a v3.1.

**APLAZADO POST-LANZAMIENTO: B8 (Dashboard)** — B10 (chat Hero PWA) y B11 (post-visita) se adelantaron y completaron
- Única tarea B8 viva en Fase 1: crear 3-4 vistas SQL guardadas para operación manual.

---

## Registro de sesiones

### 26 junio 2026 — Honorarios: % del propietario + importes en € + € en el gate ✅ DESPLEGADO Y VALIDADO E2E

Se añade el % de honorarios del **propietario** a la integración SF→Supabase y se muestran los importes en € (calculados) en la PWA y en el mensaje de honorarios del comprador. **Validado e2e** (integración con vivienda real desde SF + gate por WhatsApp).

- **BD (`supabase/sql/2026-06-26-fee-fields.sql`, aplicada):** nueva `properties.owner_fee_percent numeric NOT NULL DEFAULT 1` (1 = 1%, igual convención que `buyer_fee_percent`) + dos columnas **GENERATED ALWAYS … STORED**: `owner_fee = round(sales_price * owner_fee_percent / 100, 2)` y `buyer_fee = round(sales_price * buyer_fee_percent / 100, 2)`. Los € los calcula Postgres solo: **nunca se escriben desde app ni integración** (un INSERT/UPDATE con valor explícito sobre ellas da error).
- **Integración SF→Supabase (`create-user`):** acepta `ownerFeePercent`/`buyerFeePercent` (y alternantes `owner_fee_percent`/`buyer_fee_percent`) **dentro del objeto `property`** y los escribe en el upsert **solo si llegan** (no pisa valor existente ni el default en re-sync). **Apex (`HerohomeSupabaseCallout`):** mapea `Buyer_fee__c → buyerFeePercent` y `Owner_fee__c → ownerFeePercent`. ⚠️ **OJO nomenclatura:** los campos SF `Buyer_fee__c`/`Owner_fee__c` contienen el **porcentaje** (1; 1,5; 0,5…), no el importe; mapean a `*FeePercent` de Supabase. NO confundir con `buyer_fee`/`owner_fee` (los € generados). Bug encontrado en esta sesión: el Apex mandaba las claves `buyerFee`/`ownerFee` (no `*Percent`) → la función las ignoraba y caían al default 1. Corregido en el Apex.
- **PWA (`PropertyPage`, sección "Precios"):** muestra **Honorarios Herohome (%)** (`owner_fee_percent`) y **(€)** (`owner_fee`) en **solo lectura** (gris, no editable): son condiciones comerciales / valor calculado. Tipos añadidos a `Property` (`owner_fee_percent`, `owner_fee`, `buyer_fee_percent`, `buyer_fee`).
- **Mensaje de honorarios del comprador (`whatsapp-agent`, `buildFeeMessage`):** ahora incluye un **€ orientativo con aviso**: "Sobre el precio actual de X €, supondría aproximadamente Y €; el importe final se calculará sobre el precio que finalmente se acuerde con el vendedor." (matiz legal: la comisión se devenga sobre el precio aceptado, no el de listado). El importe se **congela en `agent_state.sales_price`** al abrir el gate para que el `consent_text` reconstruido coincida verbatim; **retrocompatible** (gates abiertos sin `sales_price` salen solo con %, idéntico al texto histórico). `buyer_fee_percent = 0` sigue saltando el gate (reserva directa).
- **Despliegue:** push a `main` → GitHub Action desplegó todas las funciones (`create-user` v39, `whatsapp-agent` con el € en el gate) + Vercel la PWA. **Decisión del usuario:** se desplegó todo junto (no se aisló `whatsapp-agent`) y luego se validó el gate por WhatsApp.
- **Validación e2e:** integración con valores no-default (Leganés: owner 0,7% / buyer 1,9% sobre 50.000 € → owner_fee 350 €, buyer_fee 950 €, exactos) y gate por WhatsApp (Santander a 1% sobre 900.000 € → "aproximadamente 9.000 €"). Para el test del gate se subió a mano `buyer_fee_percent=1` en Santander (era 0) y se reseteó el hilo `whatsapp_conversations` (messages='[]', agent_state=null) + se borró una oferta de prueba que Hero inyectaba.
- **Nota:** la `create-user` actual ignora varios campos que el Apex sí envía (`age`, `condition`, `electronicCertificate`, `garageSpace`, `heatingType`, `orientation`, `refCatastral`, `registroPropiedad`, `rejectOffersBelow`, `floor`, `description`, `elevator`, `external`, `high`) — mismo patrón clave-enviada-no-leída, pendiente si se quiere persistirlos.
- **Salesforce:** se confirma que modificar la **integración existente** (mapear 2 campos ya existentes en el Apex) **no rompe el congelado** v3.1 — SF no evoluciona más allá de ajustes de la integración. Documentado por decisión del usuario.

### 25 junio 2026 — B10: Chat de Hero en la PWA (asistente del CV) ✅ DESPLEGADO Y VALIDADO E2E

La home de la PWA (`HomePage` + `useChatSession`, que ya existían) pasa a estar viva: `chat-with-hero` es un agente operativo que ayuda al **propietario** a gestionar su venta. Construido como **hermano de `whatsapp-agent`** (misma estructura inline: `callClaude`/`runToolLoop`/`executeTool`/`ToolContext`, Sonnet 4.6, guardarraíl). **Validado e2e por el usuario desde la PWA** (vivienda de prueba de Santander).

- **`chat-with-hero/index.ts` (NUEVA):** auth = JWT del CV → `sub` → su vivienda; **todo filtrado por ese `property_id`** (aislamiento; `service_role` se salta RLS, así que el filtro por el `sub` verificado es el guardia). Historial: lee `pwa_chat_sessions` solo para contexto (el front sigue persistiendo). 6 tools:
  - **Lectura (directa, como `loadBuyerContext`):** `get_visits` (pendientes/próximas/pasadas), `get_offers` (informativo). `get_availability` **reutiliza la Edge Function `get-available-slots`**.
  - **Acción (vía Edge Function interna, anon+x-api-key):** `confirm_visit`/`cancel_visit` → `manage-visit`; `block_slots` → `block-visit-slots`. La **regla de 24h** de cancelación la aplica Hero (lee el slot y comprueba) para no cambiar el comportamiento del botón del front.
  - **Guardarraíl anti-alucinación acotado:** solo dispara con afirmaciones en 1ª persona ("he confirmado/cancelado/bloqueado"), para no chocar con descripciones de estado legítimas ("tienes una visita confirmada").
  - **Límites:** ofertas → "ve a la sección Ofertas"; consejo de aceptar/rechazar oferta → "decisión muy relevante" + asesor; disponibilidad recurrente (plantilla semanal) → sección Disponibilidad; garantista ante dudas → asesor (`https://calendar.app.google/evtp4dF7qncxggiYA` / `hola@herohome.es`).
- **`manage-visit/index.ts` (NUEVA):** acción del propietario sobre una visita (`confirm`/`cancel`). **Doble auth:** JWT del CV (PWA, deriva propiedad del `sub`) o `x-api-key` (Hero, confía en el `property_id` ya verificado). Transición atómica con guarda de estado + `notify-visit` interno (avisa al PC). **Fuente única** usada por el front y por Hero.
- **`block-visit-slots/index.ts` (NUEVA):** bloquea los `Available` de un rango (→`Not available`), TZ Madrid inline, x-api-key (como `cancel-visit-by-visitor`). `create_slots` (crear huecos) **descartado en v1**: `generate-slots` borra/regenera los `Available` futuros, así que un hueco ad-hoc se evaporaría; abrir disponibilidad se hace en la sección de Disponibilidad.
- **Front:** `useVisits` (`confirmVisit`/`cancelVisit`/`requestReschedule`) ahora invoca `manage-visit` (`invokeEdgeFunction`) en vez de escribir directo → ownership en servidor, fuente única. La regla de 24h de *reagendar* sigue en cliente.
- **Sin `config.toml`** (las 3 nuevas: `verify_jwt=true` por defecto; Hero/llamadas internas mandan anon Bearer + x-api-key) y **sin migraciones**.
- **⚠️ Lío de carpetas resuelto:** esta sesión arrancó por error en una copia **obsoleta** del repo (`~/Documents/Herohome PWA`, pre-B5). El trabajo real vive en **`~/Projects/herohome-pwa`** — futuras sesiones deben arrancar ahí. (Hubo un primer intento de B10 sobre la copia vieja, descartado por no encajar con las convenciones reales; se rehízo aquí.)

### 25 junio 2026 — B9 Gestión de Ofertas + post-visita ✅ DESPLEGADO Y VALIDADO E2E

Ciclo completo de ofertas + follow-up post-visita (B11 adelantado e integrado en B9). **Desplegado y validado end-to-end el 25 junio** (todos los caminos probados por WhatsApp + PWA y verificados por MCP). Diseño consolidado en `docs/B9-OFERTAS.md`.

- **Edge Functions nuevas:** `manage-offer` (CV decide desde la PWA: accept/deny/counter → aviso al PC por WhatsApp+email + email al equipo), `create-offer` (PC oferta por WhatsApp: importe + DNI, nombre/email del comprador desde su visita, verifica `buyer_fee_acknowledgement` —no bloquea si falta, lo marca en el aviso al equipo—, avisa al CV in-app+email y al equipo, `reject_offers_below` informativo sin auto-rechazo, enlaza como respuesta si hay contraoferta viva), `respond-counteroffer` (PC acepta/rechaza la contraoferta viva del CV → cierra + avisa CV/equipo), `post-visit-followup` (cron `*/30`: plantilla `post_visita` ~1h tras la visita Confirmed, idempotente vía `post_visit_sent_at`, ventana de 12h para no ser retroactivo, persiste el mensaje en la conversación), `save-visit-feedback` (guarda `post_visit_outcome` + `post_visit_feedback` raw en la visita).
- **Hero (`whatsapp-agent`):** +3 tools (`create_offer`, `respond_to_counteroffer`, `save_visit_feedback`) → 6 en total; contexto de negociación inyectado (`loadBuyerContext`); guardarraíl generalizado (`offerActionOk`) para no "corregir" una oferta registrada con éxito. El DNI ahora se pide al ofertar (antes prohibido en visitas).
- **Front:** `useOffers` ya no escribe directo en `offers`; invoca `manage-offer` (`invokeEdgeFunction`). `select` explícito sin `buyer_dni`/`buyer_email`. `Offer` sin `salesforce_quote_id`.
- **SQL (manual):** `2026-06-24-offers.sql` ✅ aplicada (+buyer_dni/buyer_email, `salesforce_quote_id` nullable, +`post_visit_*` en visit_slots). `2026-06-24-offers-privacy.sql` ⏳ pendiente (GRANT por columna oculta DNI/email al CV + REVOKE escritura → todo pasa por las Edge Functions). Cron 5 `post-visit-followup` en `setup-crons.sql`.
- **Plantillas Meta:** `oferta_aceptada`/`oferta_rechazada`/`contraoferta` aprobadas; `post_visita` ({{1}} nombre, {{2}} dirección) en revisión.
- **Decisiones:** CV avisado in-app + email en cada oferta; honorarios ausentes no bloquean (aviso al equipo); el feedback "no me interesa" lo **sintetiza Hero** (decisión revisada en pruebas: para explicaciones largas se prefiere un resumen, no el texto literal).
- **Validación e2e (25 junio, verificada por MCP):** `create_offer`, `manage-offer` (accept/deny/counter), `respond_to_counteroffer` (accept/reject), `create_offer` enlazada en negociación (cadena 850k→870k→860k→865k aceptada), post-visita + `save_visit_feedback`, y privacidad (el CV no lee DNI/email; no escribe `offers`).
- **Fixes durante las pruebas:** `post-visit-followup` ahora coge también visitas `Completed` (no solo `Confirmed`: `complete-visits` a las 23:00 puede marcarlas antes del follow-up de tarde-noche). El cron `post-visit-followup` debe llevar la `HEROHOME_API_KEY` real (con el placeholder daba 401) — registrado reutilizando el comando de `visit-reminders`.
- **Pendiente (no código):** Meta → modo Live (para que compradores reales reciban WhatsApp); limpieza de datos de prueba.

### 24 junio 2026 — Gate de honorarios del comprador (B13 → integrado en B5) ✅ VALIDADO E2E

Antes de confirmar una visita, el PC debe **aceptar explícitamente la comisión del 1% del comprador**. Consentimiento capturado dentro del flujo de WhatsApp (sin canal externo), con trazabilidad para una reclamación judicial. Implementado como **gate determinista fuera del LLM** (interceptor antes del loop de tool-calling), no como tool del LLM, por robustez legal.

- **Diseño elegido (opción A, deliberado):** máquina de estados determinista frente a alternativas más simples (pedir la comisión por adelantado antes de los slots, o un flag en `request_visit`). Motivo: el texto debe enviarse **verbatim** (no generado por el LLM) y la aceptación debe ser **inequívoca y aislada** (matching por palabra, no interpretación del LLM). Trade-off asumido: más código + 1 columna nueva + cambio de cron.
- **Nuevo estado `awaiting_fee_consent`** persistido en `whatsapp_conversations.agent_state` (columna `jsonb` NUEVA; el historial es solo texto y los `slot_id` no sobreviven entre turnos). Guarda `pending_property_id`, `pending_slot_id`, datos del visitante, `fee_percent`, `retries` y `gate_sent_at`.
- **Comisión configurable por vivienda** (`properties.buyer_fee_percent`, `1` = 1%, por defecto 1, **invariable** por vivienda, editable a mano antes de comercializar): el mensaje se construye en código con ese % (sigue sin generarlo el LLM); **0% se salta el gate** y reserva directo. Formato español ("0,5%", sin ceros sobrantes). El % mostrado se guarda en `agent_state.fee_percent` para que `consent_text` coincida exactamente con lo que vio el comprador.
- **El slot NO se reserva durante el gate** (sigue `Available`). Solo tras aceptar se llama a `request-visit-slot` → `Pending to confirm` → se avisa al CV. Timing correcto: el propietario no ve la solicitud antes de que el comprador acepte la comisión (respeta el Punto 7).
- **`request_visit` ya no reserva:** reúne datos (nombre, apellidos, email, consentimiento RGPD) y **dispara el gate**; el handler envía `FEE_MESSAGE` verbatim y pasa a `awaiting_fee_consent`. La reserva real ocurre en el turno siguiente solo si el PC acepta.
- **`recordFeeConsent` (función interna):** INSERT en `consents` (`type='buyer_fee_acknowledgement'`, `accepted=true`, `consent_text`=texto exacto, `wa_message_id`=wamid del "SÍ" del PC, `property_id`, `visit_slot_id`) **ANTES** de `request-visit-slot`. Si el INSERT falla → NO se reserva y se avisa al PC (mensaje genérico de reintento); el gate sigue abierto.
- **Clasificación determinista** (minúsculas+trim, palabra completa, rechazo gana sobre aceptación): acepta `sí/si/acepto/de acuerdo/ok/vale/perfecto/confirmo`; rechaza `no/no acepto/cancelar`; ambiguo → repregunta con el mismo mensaje (máx 1 reintento; 2º ambiguo = rechazo).
- **Mensaje de honorarios = texto libre** dentro de la ventana de 24h (el PC acaba de escribir): **no requiere plantilla Meta nueva**. Se guarda verbatim en `consents.consent_text`.
- **Cron `cleanup-old-slots` (02:00) — Operación 3 NUEVA:** resetea conversaciones colgadas en `awaiting_fee_consent` >24h (silencioso, sin aviso al PC; el slot nunca se movió de `Available`). Revisado antes de duplicar: la Op 2 existente expira `Pending to confirm` por `end_time` → `Not available` (semántica distinta). **No** se añadió la regla genérica `Pending to confirm + updated_at>24h → Available` (con este diseño el gate nunca deja un slot pendiente; cambiaría el comportamiento de confirmación del CV).
- **Timeout al PC NO implementado** (decisión: cron silencioso). El texto de timeout queda aparcado por si se quiere la variante Edge Function (`expire-fee-gates`) + plantilla Meta `gate_timeout`.
- **No tocado** (Punto 7): Salesforce, `offers`/`create_offer` (el DNI sigue pidiéndose ahí, B9), ni las Edge Functions de soporte (a `request-visit-slot` solo se la consume).
- **Migración requerida** (aplicar manual — MCP read-only): `supabase/sql/2026-06-23-fee-gate.sql` (consents 4 cols + `agent_state` + índice parcial + `properties.buyer_fee_percent`). Cron: re-ejecutar el bloque `cleanup-old-slots` de `supabase/sql/setup-crons.sql`.
- **Cambios:** `whatsapp-agent/index.ts` (constantes verbatim, máquina de estados, helpers `classifyFeeReply`/`recordFeeConsent`/`setAgentState`/`enterFeeGate`/`saveTurn`, `request_visit` reconvertido en disparador del gate), `supabase/sql/2026-06-23-fee-gate.sql` (nuevo), `supabase/sql/setup-crons.sql` (Op 3).
- **Estado: ✅ DESPLEGADO Y VALIDADO E2E (24 junio).** Migración aplicada (6 columnas + cron Op 3 confirmados vía MCP), `whatsapp-agent` v26 en producción. Prueba real por WhatsApp (número 34679235007, vivienda Santander al 1%): elegir slot → Hero envía el texto verbatim del 1% → "Sí" → `consents` registró `buyer_fee_acknowledgement` con el **texto exacto + el wamid del mensaje de aceptación** + property_id + visit_slot_id, y aparte el `visit_request` (RGPD) → visita `Pending to confirm` → `agent_state` limpio. Sin alucinaciones (guardarraíl OK). **Validado en los 3 casos** (24 junio, comprobado vía MCP): **1%** (registra `buyer_fee_acknowledgement` con texto exacto + wamid del "Sí"), **0,5%** (texto "comisión del 0,5%", formato español con coma) y **0%** (Hero **se salta el gate** y reserva directo: el slot queda con solo `visit_request` RGPD, sin consentimiento de honorarios). Único pendiente menor, ajeno al gate: un reask de T&C en la recogida de datos del LLM.

### 23 junio 2026 — B7 COMPLETO: recordatorios de visita + crons arreglados

- **Nueva Edge Function `visit-reminders`** (verify_jwt=false, x-api-key, cron `0 7 * * *` ~09:00 Madrid): busca visitas `Confirmed` cuya fecha local (Madrid) es MAÑANA → PC: plantilla WhatsApp `recordatorio_visita` ({{1}}=nombre, {{2}}=fecha, {{3}}=dirección) + email (`visitReminderPcHtml`); CV: email (`visitReminderCvHtml`). Sin columna extra — dedup natural por ventana "mañana". Plantilla `recordatorio_visita` aprobada en Meta (es_ES). Cron activo (jobid=13).
- **Validado e2e**: visita sembrada para mañana → `{visits_found:1, reminders_pc:1, reminders_cv:1}` → usuario confirmó "llega todo perfecto" (WhatsApp + ambos emails recibidos).
- **Fix cron `generate-daily-slots` (401):** `generate-slots` pasó a x-api-key en modo cron (verify_jwt=false). Antes fallaba con `Bearer service_role` → 401. Fix: cron usa x-api-key; modo PWA sigue con JWT + ownership check interno. Cron re-ejecutado (setup-crons.sql) y validado.
- **Cancelación por propietario + aviso al PC**: ya estaba hecho en B5 (`notify-visit` v3.1 envía `visita_cancelada` WhatsApp + email al PC). Solo se marca como completado en B7.
- Templates de email B7 en `_shared/email-templates/visit-status.ts`: `visitReminderPcHtml`, `visitReminderCvHtml`.
- Todos los crons activos y sin placeholders: `generate-daily-slots` (03:00), `cleanup-old-slots` (02:00), `complete-visits` (23:00), `visit-reminders` (07:00).

### 23 junio 2026 — B6 COMPLETO (resumen consolidado): cancelación por el PC + reagendado

Las 3 tareas de B6 implementadas, desplegadas y **validadas e2e por WhatsApp** (reservar → confirmar → cancelar por el PC → reagendar → confirmar, con notificaciones y emails). Todo lo construido/cambiado:

- **Tarea 1 — Cancelación:** Edge Function `cancel-visit-by-visitor` (verify_jwt=true, x-api-key) + tool `cancel_visit_by_visitor` en whatsapp-agent. Cancela SOLO visitas propias del comprador (filtra por `visitor_phone`; estados futuros `Pending to confirm`/`Confirmed`), update atómico → `Canceled by visitor`. Devuelve `needs_selection` (varias) o `no_visits` (ninguna). **No reabre** el slot.
- **Tarea 2 — Reagendado:** prompt → reagendar = cancelar 1 vez + reservar (sin re-cancelar al elegir el nuevo hueco); tras cancelar ofrece `get_available_slots`.
- **Tarea 3 — Aviso al CV:** `notifications` type `visit_canceled` → la PWA lo recibe por **Realtime** (`useNotifications` + `MainLayout` ya existían; cero cambios de front) **+ email al propietario** (Resend, template `ownerVisitCanceledByVisitorHtml` en `_shared/email-templates/visit-status.ts`) SOLO si la visita estaba `Confirmed`.
- **Modelo del agente: Haiku 4.5 → `claude-sonnet-4-6`.** Motivo: Haiku fallaba repetidamente la disciplina de tool-calling (alucinaba/“narraba” reservas — "tu visita está reservada", "Reservando… un momento", "ha quedado registrada" — sin llamar a `request_visit`). `process-idealista-lead` sigue en `claude-haiku-4-5` (extracción simple).
- **Guardarraíl anti-alucinación** (`runToolLoop` + post-chequeo en whatsapp-agent): si el texto final afirma una reserva (regex robusto `/(reserv|solicit|agend|confirm|registr)\w*(ad|and)|un momento|enseguida|procesando/i`) pero `request_visit` NO tuvo éxito en el turno → inyecta corrección y reintenta; si aún así afirma, mensaje seguro. Protege con cualquier modelo y **evita contaminar el historial** con confirmaciones falsas.
- **Aprendizaje clave:** el historial de conversación (solo texto, sin bloques tool_use/tool_result) se **contaminaba** con las confirmaciones falsas de intentos rotos, y eso envenenaba turnos posteriores (incluso con Sonnet). El guardarraíl evita que se guarden confirmaciones falsas.
- **Diseño del agente documentado en `docs/AGENT.md`.**

> Las dos entradas siguientes (Sonnet/AGENT.md y B6 cancelación) son la crónica detallada de cómo se llegó aquí.

### 23 junio 2026 — Agente a Sonnet 4.6 + guardarraíl anti-alucinación + AGENT.md

Probando B6, Haiku 4.5 falló DOS veces la disciplina de tool-calling: (1) alucinó "tu visita está reservada" sin llamar a `request_visit`; (2) "narró" la reserva ("Reservando… un momento") y terminó el turno sin actuar (conversación colgada).
- **Guardarraíl en código** (`runToolLoop` + post-chequeo en whatsapp-agent): si el texto final afirma/"narra" una reserva (`reservand|reservad|confirmand|confirmad|un momento|enseguida|procesando`) pero `request_visit` NO tuvo éxito en el turno, se inyecta una corrección al modelo y se reintenta el loop; si aún así afirma una reserva, se sustituye por un mensaje seguro. Protege con cualquier modelo.
- **Modelo del agente: Haiku 4.5 → `claude-sonnet-4-6`** (mejor disciplina de tools, menos alucinación). `process-idealista-lead` sigue en `claude-haiku-4-5` (extracción simple de una sola llamada).
- **Nuevo `docs/AGENT.md`**: documenta cómo está modelado Hero (persona, objetivos, contexto inyectado, reglas, procedimientos, tools, loop+guardarraíl, y dónde tocar para iterarlo).

### 22 junio 2026 — B6: cancelación de visita por el comprador (PC)

Implementadas las 3 tareas de B6:
- **Edge Function `cancel-visit-by-visitor`** (verify_jwt=true, x-api-key; misma pauta que request-visit-slot): busca las visitas futuras cancelables del comprador POR SU TELÉFONO (solo las suyas; estados `Pending to confirm`/`Confirmed`), cancela (status → `Canceled by visitor`, update atómico guardado por teléfono+estado anti-carrera) y notifica al CV (`notifications`, type `visit_canceled`). Si hay varias visitas devuelve `needs_selection` con la lista (`display` + `slot_id`); si no hay ninguna, `no_visits`.
- **Tool `cancel_visit_by_visitor`** en whatsapp-agent: `executeTool` añade `wa_phone_number` + `property_id` del contexto; `slot_id` opcional para desambiguar.
- **Reagendado**: el prompt indica que, tras cancelar con éxito, ofrezca reagendar reutilizando `get_available_slots`.
- **Notificación al CV**: NO requirió tocar la PWA — `useNotifications` ya se suscribe por Realtime a los INSERT en `notifications` (`notifications:${user.id}`, postgres_changes) y `MainLayout` ya tiene icono ❌ / etiqueta "Visita cancelada" / ruta para `visit_canceled`. Solo se inserta la fila.
- Decisión de diseño: la cancelación **NO reabre** el slot (queda `Canceled by visitor`, no vuelve a `Available`), igual que la cancelación por el propietario. Reabrir slots cancelados sería una mejora futura.
- Pendiente: **prueba end-to-end por WhatsApp** (reservar → cancelar → ver notificación en la PWA + re-oferta de slots).

### 22 junio 2026 — B5 validado END-TO-END (plantillas + email reales)

Plantillas de Meta aprobadas (`bienvenida_pc`, `visita_confirmada`, `visita_cancelada`). Flujo completo probado en producción: lead simulado → `process-idealista-lead` envía `bienvenida_pc` (recibida) + siembra conversación → el comprador chatea con Hero, pide horarios (slots reales de Santander) y reserva visita (email obligatorio + consentimiento) → el CV confirma en la app → `notify-visit` envía plantilla `visita_confirmada` por WhatsApp + email (Resend, branding Herohome) al comprador.

Ajustes de la sesión: (a) Hero ya no inventa "te he enviado un email" (prompt reforzado — solo el sistema notifica al confirmar el propietario); (b) `notify-visit` compone la dirección solo con `street + city` — el campo `state` traía `'S'` (código heredado de SF) que salía como "…, Santander, S"; (c) **CONVENCIÓN DE IDIOMA DE PLANTILLAS WhatsApp = `es_ES`**: `send-whatsapp.ts` envía `es_ES` por defecto, así que TODAS las plantillas deben crearse en Meta como **"Spanish (SPA)"** (= `es_ES`), no "Spanish" (= `es`). Si el idioma no coincide, el envío de plantilla falla y solo funciona el fallback de texto (válido solo dentro de la ventana de 24h). Las `visita_*` pasaron por inglés (caían al fallback) y luego "Spanish"/es (seguía sin cuadrar) antes de quedar en `es_ES`. Validado el 22 junio cancelando una visita real: llegó la plantilla `visita_cancelada` (con 👋 y "por el propietario", dirección limpia) + email de cancelación (Resend).

**Estado B5: funcionalmente completo y validado.** Único pendiente real: que el Escenario 2 de Make dispare con el PRIMER email real de Idealista (la función ya está validada vía curl). Limpieza opcional pendiente: datos de prueba (visitas/conversaciones de test), escenario Make obsoleto `whatsapp-herohome-inbound`, secret `MAKE_WEBHOOK_NOTIFY_VISIT`.

### 22 junio 2026 — Rediseño de la generación de slots (ventana móvil de 14 días)

**Problema detectado:** `generate-slots` corría solo el día 20 (cron `generate-monthly-slots`) y generaba 28 días → una vivienda dada de alta el día 21 no tenía slots hasta el mes siguiente. Y dos bugs vivos: (1) el filtro del cron usaba `status = 'On Sale'` pero la BD tiene `'On sale'` → **el cron no generaba NADA para ninguna vivienda**; (2) la PWA guardaba `availability_config` pero **nunca disparaba la generación** de slots.

**Modelo nuevo — sincronización de ventana móvil:** `generate-slots` ahora SINCRONIZA una ventana de hoy + 14 días por vivienda, idempotente:
- **Crea** los slots de la config que falten (solo si esa hora no tiene ya un slot, de cualquier estado → no duplica reservas).
- **Borra** los `Available` futuros que ya no encajan con la config o que quedan fuera de la ventana (refleja reducciones de disponibilidad y recorta sobrantes a 2 semanas).
- **Nunca** toca `Pending to confirm` / `Confirmed` / bloqueados.
- Descartado "generar solo el día +14" (frágil: una noche fallida deja un hueco permanente) y "borrar todo Available y regenerar" (duplicaría slots a horas ya reservadas → doble reserva).

**Disparadores:**
- Cron **`generate-daily-slots`** a las **03:00 UTC** (tras `cleanup-old-slots` de 02:00) → modo cron, todas las viviendas `On sale`. Auto-reparable: si una noche falla, la siguiente rellena los huecos.
- PWA `useAvailability.saveConfig` → llama a `generate-slots` (modo single-property, ownership check por JWT) al pulsar "Guardar disponibilidad" → slots inmediatos.

**Cambios:** `generate-slots/index.ts` (lógica de sync, `DAYS_AHEAD` 28→14, fix `'On sale'`); `src/hooks/useAvailability.ts` (llama a generate-slots tras guardar); `supabase/sql/setup-crons.sql` (`generate-monthly-slots` día 20 → `generate-daily-slots` diario 03:00 UTC). `cleanup-old-slots` (02:00 UTC) sin cambios.

**Aplicado y validado (22 junio):** cron `generate-daily-slots` registrado (jobid 12, 03:00 UTC) y `generate-monthly-slots` eliminado. Probado en producción end-to-end: al guardar disponibilidad desde la PWA (config Jue 18h / Vie-Sáb 10-14h) la ventana de 14 días se sincronizó correctamente → se borraron los días quitados (L/M/X), se generaron los slots horarios de la config (Vie/Sáb 10:00-13:00), sin duplicados y conservando la visita confirmada de Roberto. Nota operativa: el Service Worker de la PWA cachea; para ver cambios de la PWA al instante hay que recargar/usar incógnito hasta que el SW se actualice.

### 22 junio 2026 — Plantillas WhatsApp aprobadas + fix idioma (es_ES)

Las 3 plantillas (`bienvenida_pc`, `visita_confirmada`, `visita_cancelada`) se aprobaron en Meta, pero creadas con idioma **Spanish (Spain) = `es_ES`**, mientras el código pedía `es` → error 132001 ("template name does not exist in es"). **Fix:** idioma por defecto centralizado en `_shared/send-whatsapp.ts` → **`es_ES`** (y eliminado el `languageCode` explícito de `process-idealista-lead` y `notify-visit`). ⚠️ Toda plantilla nueva debe crearse en `es_ES` (o ajustar ese default). `process-idealista-lead` ahora devuelve `whatsapp_error` en la respuesta de alerta (observabilidad). **Camino feliz validado:** lead simulado (número real + ref Santander) → `bienvenida_pc` entregada + conversación sembrada (conv `13bb6fd7`).

---

### 15 junio 2026 — B5: código de whatsapp-agent y process-idealista-lead

- **Cambio de modelo IA**: GPT-4o → **Claude Haiku 4.5** (Anthropic API) para el motor conversacional. Motivo: la suscripción Claude Pro del usuario no cubre uso de API (sistemas de facturación independientes); Haiku 4.5 sale 2-4x más barato que GPT-4o para este caso de uso (historial corto + tool calling), con tool use nativo. Actualizado en `ARCHITECTURE_V3_DECISIONS.md` y aquí: secret `OPENAI_API_KEY` → `ANTHROPIC_API_KEY`.
- **Nuevo** `_shared/send-whatsapp.ts`: helper compartido (`sendWhatsAppText`, `sendWhatsAppTemplate`) sobre WhatsApp Cloud API v25.0.
- **Nuevo** `_shared/email-templates/idealista-lead-alert.ts`: plantilla de alerta para Resend.
- **Nuevo** `process-idealista-lead/index.ts`: POST con `x-api-key`, extrae teléfono/nombre/referencia del email de Idealista vía Claude Haiku 4.5 (tool-calling forzado, JSON), busca la propiedad por `salesforce_account_id`, normaliza el teléfono a E.164, evita duplicados, envía plantilla de bienvenida WhatsApp y siembra `whatsapp_conversations`. Alerta por Resend a `hola@herohome.es` si falla la extracción o no se encuentra la propiedad.
- **Nuevo** `whatsapp-agent/index.ts`: GET responde `hub.challenge` (verificación con `WHATSAPP_VERIFY_TOKEN`); POST valida HMAC `X-Hub-Signature-256` (constant-time compare), carga historial + propiedad asociada, loop de tool calling con Claude Haiku 4.5 (`get_available_slots`, `request_visit`), inserta en `consents` cuando el comprador acepta RGPD antes de `request_visit`, responde por WhatsApp Cloud API y persiste con `save-message`. Siempre devuelve 200 a Meta (errores se loggean y se notifican al usuario por WhatsApp) salvo firma inválida (403).
- **`verify_jwt` (resuelve parte de B14)**: se verificó vía MCP que **todas** las Edge Functions existentes tienen `verify_jwt=true` (el gateway de Supabase exige JWT; los llamadores envían la anon key como Bearer y la auth real es el `x-api-key` interno). Consecuencias en B5:
  - Creado `supabase/config.toml` con `verify_jwt=false` SOLO para `whatsapp-agent` y `process-idealista-lead` (Meta/Make no envían JWT). Las demás funciones se dejan en `true` (su estado actual; el "flip a false de todas las x-api-key" del B14 queda pendiente y requiere revisar la auth interna de create-user/send-welcome-email/generate-slots/notify-visit antes de tocarlas).
  - **Bug corregido en whatsapp-agent**: `callInternalFunction` ahora envía `Authorization: Bearer ${SUPABASE_ANON_KEY}` además del `x-api-key`, porque las funciones-tool internas (get-available-slots, request-visit-slot, save-message) tienen `verify_jwt=true` y el gateway las rechazaría (401) sin JWT.
- **Secrets cargados**: `ANTHROPIC_API_KEY` y `META_APP_SECRET` ya estaban; añadidos `WHATSAPP_TOKEN` (token PERMANENTE de usuario del sistema ya cargado el 17 junio; el temporal inicial quedó sustituido), `WHATSAPP_PHONE_NUMBER_ID=1047339358460376`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_WELCOME_TEMPLATE_NAME=bienvenida_pc`. Sigue existiendo `OPENAI_API_KEY` (obsoleta, eliminar) y `MAKE_WEBHOOK_NOTIFY_VISIT` (eliminar al reescribir notify-visit). WhatsApp Business Account ID: `1424979468699232`.
- **Desplegadas (15 junio)**: `whatsapp-agent` y `process-idealista-lead` desplegadas vía CLI a producción con `verify_jwt=false` (confirmado vía MCP). Verificación del webhook probada con curl: GET con verify token correcto → 200 + challenge; GET con token incorrecto → 403; POST sin firma HMAC → 403. ⚠️ El flujo POST completo (mensaje firmado → Claude → tools → respuesta) NO se ha podido probar todavía porque requiere una firma HMAC real de Meta (no tenemos el valor de `META_APP_SECRET`, solo el digest). Se valida al conectar Meta.
- **EN VIVO (17 junio)**: webhook de Meta conectado y verificado; chat entrante probado en producción (mensaje en frío → Hero responde correctamente redirigiendo a Idealista al no haber vivienda asociada → conversación persistida en `whatsapp_conversations`, 2 msgs); token permanente activo. El flujo conversacional núcleo de `whatsapp-agent` está validado end-to-end.
- **Tool calling validado + bug corregido (21 junio)**: prueba end-to-end del camino de reserva con vivienda de prueba (`c6b32026…`, Santander) y 12 slots sembrados a mano por SQL. **1er intento falló**: `get_available_slots` funcionó pero Hero **alucinó la confirmación** ("tu visita está reservada") SIN llamar a `request_visit` (0 en BD, 0 en logs). Causa: (a) los `slot_id` no se persisten entre turnos — solo se guarda el texto del chat, no los bloques tool_use/tool_result — y (b) el prompt no prohibía confirmar sin tool. **Fix**: prompt reforzado (procedimiento OBLIGATORIO: volver a llamar a `get_available_slots` para recuperar el `slot_id` justo antes de reservar; NUNCA confirmar sin éxito real de `request_visit`) + redeploy. **2º intento ✅**: reserva real (slot `bc58fd61…` → `Pending to confirm`, Roberto Gavilán Cruz, notificación al propietario, consentimiento en `consents`). **Camino `get_available_slots` → `request_visit` validado end-to-end. Tarea del whatsapp-agent COMPLETA.**
  - ⚠️ Limitación de diseño conocida: el historial persistido es solo texto (`{role, content}`), no los bloques de tool calling. Mitigación actual: el agente re-consulta los slots en cada turno de reserva. Si en el futuro alguna tool necesita estado entre turnos, habría que persistir el array de mensajes Anthropic completo (tool_use/tool_result) — cambio en `save-message` + carga del agente.
- **notify-visit reescrita v3.1 (tareas B5 #8 y #9, 21 junio)**: ya no usa Make. Al confirmar/cancelar desde la PWA, notifica al PC directamente: WhatsApp (plantilla `visita_confirmada`/`visita_cancelada` con 3 params [nombre, dirección, fecha/hora]; **fallback a texto libre** si la plantilla falla — válido dentro de la ventana de 24h) + email Resend si hay `visitor_email`. Plantillas HTML nuevas en `_shared/email-templates/visit-status.ts`. Mantiene `verify_jwt=true` (la invoca la PWA con sesión). Pendiente: aprobar en Meta las plantillas `visita_confirmada`/`visita_cancelada` (hasta entonces, en producción >24h no se entregaría el WhatsApp); el secret `MAKE_WEBHOOK_NOTIFY_VISIT` ya se puede eliminar y el Escenario 3 de Make desactivar.
- **Email del PC OBLIGATORIO en la reserva (21 junio)**: a petición de negocio, Hero exige el email antes de reservar (se usará para ofertas/contrato en B9). Enforzado en prompt + tool `request_visit` (requerido) + `request-visit-slot` (validación servidor). URL de consentimiento actualizada a `https://www.herohome.es/terminos-y-condiciones`. Nota RGPD: el email se captura en la visita; el **DNI** se sigue capturando solo en la oferta (B9). Efecto colateral positivo: al tener email, las confirmaciones de `notify-visit` también se entregan por email (Resend), no solo WhatsApp.
- **Flujo Idealista — validación parcial (21 junio)**: 3 plantillas WhatsApp creadas (pendientes de aprobación en Meta); Make Esc. 2 reconfigurado (Gmail Watch → HTTP POST a `process-idealista-lead` con `x-api-key`; body con `subject`/`textBody`/`fromEmail`). `process-idealista-lead` probada con email simulado vía curl: ✅ extracción LLM (nombre, teléfono→E.164, referencia), ✅ lookup por `salesforce_account_id` (encontró la vivienda de Santander), ✅ alerta Resend al fallar el envío de plantilla (pendiente de aprobación), sin sembrar conversación (correcto). Falta el camino feliz (bienvenida entregada + conversación sembrada) tras aprobar `bienvenida_pc`, y la prueba e2e con email real vía Make (tarea 10).
- **`HEROHOME_API_KEY` rotada (21 junio)**: valor nuevo generado y guardado por el usuario; redeploy de las 6 funciones que la usan (whatsapp-agent + 4 internas + process-idealista-lead) para mantener consistencia. NO la usan create-user/Salesforce ni la PWA (verificado por grep). Make la envía como cabecera `x-api-key`.
- **Pendiente (no código)**: aprobar las plantillas WhatsApp en Meta; prueba e2e del flujo Idealista; mejora menor: afinar el prompt de Hero en la rama "sin vivienda asociada" (no debe pedir el enlace del anuncio). Limpieza: borrar el escenario Make `whatsapp-herohome-inbound` (obsoleto), el secret `MAKE_WEBHOOK_NOTIFY_VISIT` y los datos de prueba (visita de Roberto + slots de Santander).

---

### 14 junio 2026 — Fix definitivo Magic Link (env var + Service Worker)

**Síntoma:** al pedir el magic link y pulsar el enlace del email, el usuario acababa en `/login?error=magiclink` ("Su enlace de acceso ha caducado o no es válido. Solicita uno nuevo") en vez de entrar a la app. También fallaba el aviso "no es cliente" al pedir el enlace (mensaje genérico "No se pudo enviar el enlace").

**Causa raíz #1 — env var mal configurada en Vercel:**
`VITE_SUPABASE_URL` en producción tenía el sufijo `/rest/v1` (p.ej. `https://zqkvcphtqmibttgnivku.supabase.co/rest/v1` en vez de solo `https://zqkvcphtqmibttgnivku.supabase.co`). Esto rompía:
- El RPC `check_user_exists_by_email` (`.../rest/v1/rpc/...` → se duplicaba el prefijo `/rest/v1` → 404 → "No se pudo enviar el enlace").
- La validación de sesión post-callback (`supabase-js` llamaba a `.../rest/v1/auth/v1/user` → 404 → sesión nunca se establece → timeout → `/login?error=magiclink`).

Fix: borrada y recreada `VITE_SUPABASE_URL` (y `VITE_SUPABASE_ANON_KEY`) en Vercel con el valor correcto, sin `/rest/v1` ni barra final, + Redeploy. Vercel oculta el valor de las env vars existentes (solo permite editar/borrar sin verlas) — por eso hubo que recrearla en lugar de inspeccionarla.

**Causa raíz #2 — Service Worker con código cacheado antiguo:**
Con la env var ya corregida, el primer clic en el magic link SÍ autenticaba correctamente en Supabase (verificado vía `mcp__supabase__get_logs` service `auth`: `GET /verify` → `303` → evento `Login` exitoso con `login_method: implicit`). Pero el navegador móvil tenía cacheada por el Service Worker (PWA) una versión antigua de la app sin manejo real de `/auth/callback`, así que el login no se reflejaba en pantalla. El usuario volvía a pulsar el mismo enlace del email → segundo `GET /verify` con el mismo token → `403 "One-time token not found" / Email link is invalid or has expired` → de ahí el `?error=magiclink`. Confirmado: en modo incógnito (sin SW) el flujo funcionaba perfecto a la primera.

**Fix aplicado (commit `e52ab9d`, sobre la base del fix de redirect/callback ya mergeado en `14c64a5`):**
- `vite.config.ts`: `VitePWA({ injectRegister: false, workbox: { cleanupOutdatedCaches: true, clientsClaim: true, skipWaiting: true }, ... })`.
- `src/main.tsx`: registro explícito vía `virtual:pwa-register` — `registerSW({ immediate: true, onNeedRefresh: () => location.reload(), onRegisteredSW: (_, reg) => { reg?.update(); setInterval(() => reg?.update(), 3600_000) } })`.
- `src/vite-env.d.ts`: añadida referencia de tipos `vite-plugin-pwa/client`.

**Resultado:** flujo de magic link (incluido el aviso "no es cliente") verificado funcionando end-to-end en producción. Cualquier usuario con una versión antigua de la PWA instalada se actualizará y recargará automáticamente al detectar el nuevo Service Worker.

---

### 12 junio 2026 — Migración a plan v3.1
- Decisión arquitectónica v3.1: agente WhatsApp en Edge Function (no Make); Resend único canal email (Escenarios Make 3-6 eliminados); Salesforce congelado; B8/B10/B11 aplazados; parsing Idealista con LLM.
- B14 completado: Supabase MCP (read-only) + GitHub Action con filtro paths + docs actualizados.
- Eliminado `CLAUDEinstructions.md` (contenido duplicado y status values obsoletos en minúsculas — fuente de bugs).

### 28 mayo 2026
- Eliminadas llamadas prohibidas a `update-property-to-sf` y `update-offer-to-sf` (v2.0).
- `vercel.json` creado (fix 404 SPA). `create-user` renombrado y sincronizado con producción.
- GitHub Actions de deploy configurado. `notify-visit` creada (versión Make, a reescribir en v3.1).

---

## Documentos de referencia

- `ARCHITECTURE_V3_DECISIONS.md` — decisiones arquitectónicas v3.1 (en este repo, AUTORITATIVO).
- `docs/AGENT.md` — diseño del agente conversacional Hero (WhatsApp): persona, objetivos, reglas, tools, loop.
- `docs/SPEC.md` — especificación técnica (revisar contra v3.1 antes de usar).
- **Plan de tareas v3.1** — Google Sheets (hojas: Plan v3.1 / Cambios v3.0→v3.1 / Camino crítico / Resumen).
- DESIGN.md, Arquitectura Técnica, modelos de datos — Google Drive.


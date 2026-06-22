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
- **Hero**: agente IA (Claude Haiku 4.5, Anthropic API). Instancia activa: Agente WhatsApp (`whatsapp-agent`). El Agente PWA está aplazado (B10).
- **Agente Herohome**: persona humana para tareas no automatizables. Opera con el Table Editor de Supabase + vistas SQL (el Dashboard completo está aplazado, B8).

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| PWA Frontend (CV) | React 18 + Vite + TypeScript + Tailwind CSS — **este repo** |
| Backend / BD / Lógica | Supabase (PostgreSQL + Auth + Edge Functions + Cron) |
| Agente WhatsApp | Edge Function `whatsapp-agent` (Claude Haiku 4.5, tool calling) |
| CRM | Salesforce Enterprise + Docs/Sign Made Easy — **CONGELADO: no añadir nada** |
| Email transaccional (CV y PC) | Resend desde Edge Functions (plantillas HTML en código) |
| Make.com | SOLO: Esc. 1 (form web → Lead SF) y Esc. 2 (Gmail Idealista → Edge Function) |
| WhatsApp | WhatsApp Cloud API (Meta) — webhook apunta a `whatsapp-agent` |
| IA | Anthropic API — modelo `claude-haiku-4-5` |
| Hosting | Vercel (auto-deploy desde GitHub) |
| Dashboard Operaciones | APLAZADO (B8) — interim: Supabase Table Editor + vistas SQL |

---

## Arquitectura v3.1 — Reglas que Claude Code DEBE respetar

- **Salesforce está CONGELADO.** No crear campos, Flows ni Apex. Su único rol: Leads → Flow 1 (botón "Enviar acceso PWA") → contratos/firma.
- **NO crear** Edge Functions de sync con Salesforce (`update-property-to-sf`, `update-offer-to-sf`, `confirm-visit-to-sf`, `sync-offer-from-sf`) — eliminadas en v3.0.
- **NO escribir** en `salesforce_event_id` (visit_slots) ni `salesforce_quote_id` (offers) — legacy nullable.
- **Todo email sale por Resend** desde Edge Functions. Los webhooks a Make para notificaciones están ELIMINADOS (Escenarios 3-6 de Make no existen en v3.1).
- El agente de WhatsApp vive en `whatsapp-agent` (Edge Function), NO en Make. Validar firma HMAC de Meta en cada POST.
- **NO construir** B8 (Dashboard), B10 (chat Hero PWA) ni B11 (post-visita) hasta el post-lanzamiento.
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
- **Pendiente técnico:** revisar `config.toml` de las funciones que se invocan con `x-api-key` para fijar `verify_jwt = false` (que el deploy automático no reactive la verificación JWT).
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
| `visit-reminders` | Cron diario 09:00 | ⬜ Pendiente (B7) |
| `manage-offer` | HTTP POST desde PWA | ⬜ Pendiente (B9) |
| `create-offer` | Tool de whatsapp-agent (gate de honorarios) | ⬜ Pendiente (B9) |
| `complete-visits` | Cron diario 23:00 | ⬜ Aplazado (B11) — verificar si el cron ya existe |
| `chat-with-hero` | HTTP POST desde PWA | ⏸️ Aplazada (B10, post-lanzamiento) |

### Secrets de Supabase (estado objetivo v3.1)
- `RESEND_API_KEY` (pendiente rotación, B12)
- `PWA_BASE_URL` (`https://app.herohome.es`)
- `ANTHROPIC_API_KEY` — NUEVO (whatsapp-agent y process-idealista-lead, modelo `claude-haiku-4-5`)
- `META_APP_SECRET` — NUEVO (validación HMAC)
- `WHATSAPP_VERIFY_TOKEN` — NUEVO (verificación GET del webhook de Meta, string propio)
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — envío Cloud API
- `WHATSAPP_WELCOME_TEMPLATE_NAME` — NUEVO (plantilla de bienvenida aprobada en Meta; por defecto `bienvenida_pc`)
- ~~`MAKE_WEBHOOK_NOTIFY_VISIT`~~ — ELIMINAR al reescribir notify-visit

---

## Make.com — Escenarios (v3.1)

| # | Escenario | Estado |
|---|-----------|--------|
| 1 | Formulario web → Lead en Salesforce | ✅ Activo |
| 2 | Gmail Watch (Idealista) → HTTP a process-idealista-lead (2 módulos) | 🔄 Reconfigurar (B5) |
| 3-6 | Notificaciones vía Gmail | ❌ ELIMINADOS en v3.1 (Esc. 3 activo: desactivar al desplegar notify-visit v3.1) |
| — | Webhook WhatsApp entrante en Make | ❌ ELIMINADO: el webhook de Meta apunta a whatsapp-agent |

---

## Estado del proyecto (actualizado 12 junio 2026 — plan v3.1)

**B0-B4 — Fundamentos, Activación CV, PWA, Edición, Slots: ✅ COMPLETADOS**
- ✅ Bug del Magic Link (route guard + Service Worker stale) resuelto 14 junio 2026 — ver Registro de sesiones.

**B5 — Agente WhatsApp + Visitas: 🔄 EN CURSO** ← **CAMINO CRÍTICO**
- ✅ Edge Functions de soporte (slots, historial, mensajes). PWA: visitas pendientes + próximas + reagendar.
- ✅ Código de `whatsapp-agent` (webhook Meta + HMAC + loop Claude Haiku 4.5 + tools get_available_slots/request_visit) — pendiente desplegar y configurar secrets/webhook.
- ✅ Código de `process-idealista-lead` (extracción con Claude Haiku 4.5 + lookup Supabase + WhatsApp bienvenida + alerta Resend) — pendiente desplegar y reconfigurar Make Esc. 2.
- ⬜ Reescribir `notify-visit` (Resend + WhatsApp directo).
- 🔄 Plantillas WhatsApp en Meta (en curso por el usuario) + plantillas email en código.
- ⬜ Reapuntar webhook de Meta a la Edge Function. Reconfigurar Make Esc. 2. Validación end-to-end.

**B6 — Reagendado PC: 🔄 EN CURSO** (tools sobre whatsapp-agent)
- ✅ Tool `cancel_visit_by_visitor` + Edge Function `cancel-visit-by-visitor` (cancela solo visitas propias por teléfono, status → `Canceled by visitor`, notifica al CV vía `notifications` type `visit_canceled` → la PWA lo recibe por Realtime que ya existía en `useNotifications`).
- ✅ Lógica del agente: tras cancelar con éxito ofrece reagendar (prompt + reutiliza `get_available_slots`).
- ⬜ Pendiente probar el flujo end-to-end por WhatsApp.
**B7 — Reagendado CV + Recordatorios: ⬜ PENDIENTE** (visit-reminders con Resend directo)
**B9 — Gestión de Ofertas: ⬜ PENDIENTE** (manage-offer + tool create_offer con gate de honorarios; bloqueado parcialmente por decisión legal B13)
**B12 — QA y Lanzamiento: ⬜ PENDIENTE** (RLS, rotación de secrets, pen test incl. HMAC, monitoring)

**B13 — Negocio y Legal: 🔄 EN CURSO (paralelo, no técnico)**
- Revisión pricing "primera venta gratis" · contrato reconocimiento honorarios comprador (abogado) · momento de firma · plan de captación.

**B14 — Infraestructura de desarrollo: ✅ COMPLETADO (12 junio 2026)**
- ✅ Supabase MCP conectado en Claude Code (read-only, scoped al proyecto).
- ✅ GitHub Action de deploy verificado + filtro `paths` añadido. Secrets limpiados.
- ✅ CLAUDE.md y ARCHITECTURE_V3_DECISIONS.md actualizados a v3.1.

**APLAZADOS POST-LANZAMIENTO: B8 (Dashboard) · B10 (chat Hero PWA) · B11 (post-visita)**
- Única tarea B8 viva en Fase 1: crear 3-4 vistas SQL guardadas para operación manual.

---

## Registro de sesiones

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
- `docs/SPEC.md` — especificación técnica (revisar contra v3.1 antes de usar).
- **Plan de tareas v3.1** — Google Sheets (hojas: Plan v3.1 / Cambios v3.0→v3.1 / Camino crítico / Resumen).
- DESIGN.md, Arquitectura Técnica, modelos de datos — Google Drive.


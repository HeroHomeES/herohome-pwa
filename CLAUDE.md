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
- **Hero**: agente IA (GPT-4o). Instancia activa: Agente WhatsApp (`whatsapp-agent`). El Agente PWA está aplazado (B10).
- **Agente Herohome**: persona humana para tareas no automatizables. Opera con el Table Editor de Supabase + vistas SQL (el Dashboard completo está aplazado, B8).

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| PWA Frontend (CV) | React 18 + Vite + TypeScript + Tailwind CSS — **este repo** |
| Backend / BD / Lógica | Supabase (PostgreSQL + Auth + Edge Functions + Cron) |
| Agente WhatsApp | Edge Function `whatsapp-agent` (GPT-4o, tool calling) |
| CRM | Salesforce Enterprise + Docs/Sign Made Easy — **CONGELADO: no añadir nada** |
| Email transaccional (CV y PC) | Resend desde Edge Functions (plantillas HTML en código) |
| Make.com | SOLO: Esc. 1 (form web → Lead SF) y Esc. 2 (Gmail Idealista → Edge Function) |
| WhatsApp | WhatsApp Cloud API (Meta) — webhook apunta a `whatsapp-agent` |
| IA | OpenAI GPT-4o vía API |
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
| `generate-slots` | Cron día 20 + manual | ✅ Completada |
| `cleanup-slots` | Cron diario 02:00 | ✅ Completada |
| `get-available-slots` | Tool de whatsapp-agent | ✅ Completada |
| `request-visit-slot` | Tool de whatsapp-agent | ✅ Completada |
| `get-conversation-history` | Interna desde whatsapp-agent | ✅ Completada |
| `save-message` | Interna desde whatsapp-agent | ✅ Completada |
| `notify-visit` | HTTP POST desde PWA | 🔄 REESCRIBIR (B5): Resend + WhatsApp directo, sin Make |
| `whatsapp-agent` | Webhook de Meta (GET + POST con HMAC) | ⬜ NUEVA (B5) ← **PRÓXIMO PASO** |
| `process-idealista-lead` | HTTP POST desde Make Esc. 2 | ⬜ NUEVA (B5) |
| `cancel-visit-by-visitor` | Tool de whatsapp-agent | ⬜ Pendiente (B6) |
| `visit-reminders` | Cron diario 09:00 | ⬜ Pendiente (B7) |
| `manage-offer` | HTTP POST desde PWA | ⬜ Pendiente (B9) |
| `create-offer` | Tool de whatsapp-agent (gate de honorarios) | ⬜ Pendiente (B9) |
| `complete-visits` | Cron diario 23:00 | ⬜ Aplazado (B11) — verificar si el cron ya existe |
| `chat-with-hero` | HTTP POST desde PWA | ⏸️ Aplazada (B10, post-lanzamiento) |

### Secrets de Supabase (estado objetivo v3.1)
- `RESEND_API_KEY` (pendiente rotación, B12)
- `PWA_BASE_URL` (`https://app.herohome.es`)
- `OPENAI_API_KEY` — NUEVO (whatsapp-agent)
- `META_APP_SECRET` — NUEVO (validación HMAC)
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — envío Cloud API
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
- ⬜ Edge Function `whatsapp-agent` (webhook Meta + HMAC + loop GPT-4o + tools) — **siguiente tarea de Claude Code**.
- ⬜ Edge Function `process-idealista-lead` (parsing LLM).
- ⬜ Reescribir `notify-visit` (Resend + WhatsApp directo).
- ⬜ Plantillas WhatsApp en Meta (aprobación externa, en paralelo) + plantillas email en código.
- ⬜ Reapuntar webhook de Meta a la Edge Function. Reconfigurar Make Esc. 2. Validación end-to-end.

**B6 — Reagendado PC: ⬜ PENDIENTE** (tools sobre whatsapp-agent)
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


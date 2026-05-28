# Herohome PWA — Contexto para Claude Code

> Este archivo se carga automáticamente al inicio de cada sesión.
> Actualizar al final de cada sesión y hacer push a GitHub.

---

## Qué es Herohome

Herohome es la primera agencia inmobiliaria 100% digital de España. Propietarios venden su vivienda asistidos por un agente IA llamado **Hero**. Comisión: 1% al vendedor + 1% al comprador. Web: herohome.es (Webflow).

**Naming:** Herohome (nunca HeroHome ni HEROHOME). El agente IA se llama Hero (nunca "el bot" ni "la IA").

---

## Actores del sistema

- **CV** (Cliente Vendedor): propietario con contrato. Accede a la PWA.
- **PC** (Prospecto Comprador): interesado en comprar. Solo interactúa vía WhatsApp.
- **PV** (Prospecto Vendedor): sin contrato. No accede a la PWA.
- **Hero**: agente IA (GPT-4o). Dos instancias: Agente PWA (asiste al CV) y Agente WhatsApp (atiende al PC).
- **Agente Herohome**: persona humana para tareas no automatizables. Usa el Dashboard de Operaciones.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| PWA Frontend (CV) | React 18 + Vite + TypeScript + Tailwind CSS — **este repo** |
| Dashboard Operaciones | React + Vite + TS + Tailwind + Supabase Realtime — repo separado |
| Backend / BD | Supabase (PostgreSQL + Auth + Edge Functions) |
| CRM | Salesforce Enterprise + Docs Made Easy + Sign Made Easy |
| Orquestación | Make.com + Supabase Cron |
| Email CV | Edge Function + Resend |
| Email PC | Make.com + Gmail (hola@herohome.es, DKIM/DMARC verificado) |
| WhatsApp | WhatsApp Cloud API (Meta) |
| IA | OpenAI GPT-4o via API |
| Hosting | Vercel (auto-deploy desde GitHub) |
| Web corporativa | Webflow (herohome.es) |

---

## Arquitectura v3.0 — Reglas fundamentales

**Salesforce** = registro legal y contractual. **Supabase** = sistema operativo de la venta.

Los datos fluyen SF → Supabase **una sola vez** (al crear usuario vía `create-user`). A partir de ahí Supabase es la fuente de verdad. **NO existen integraciones bidireccionales SF ↔ Supabase.**

### Reglas que Claude Code DEBE respetar

- **NO crear** Edge Functions de sincronización con Salesforce: `update-property-to-sf`, `update-offer-to-sf`, `confirm-visit-to-sf`, `sync-offer-from-sf` — pertenecen a v2.0 y están eliminadas.
- **NO escribir** en `salesforce_event_id` (visit_slots) ni `salesforce_quote_id` (offers) — campos legacy nullable.
- Notificaciones al PC: siempre vía webhook Make → Gmail. Nunca vía Salesforce Flows.
- Email de bienvenida al CV: vía Edge Function + Resend (no Make).
- UI en **español**. Mobile-first (375px primero).
- Diseño: Inter como fuente. Color primario **#5B5CFF**. Sin box-shadows (usar bordes). Estética Stripe/Linear.
- Leer `ARCHITECTURE_V3_DECISIONS.md` antes de proponer funcionalidades o Edge Functions.

---

## Supabase

- **URL:** `https://zqkvcphtqmibttgnivku.supabase.co`
- **Anon key:** en `.env` como `VITE_SUPABASE_ANON_KEY`
- **Auth:** Magic Link (email). Sesiones de 7 días.
- **RLS:** activado. Cada usuario solo ve sus propios datos.
- NUNCA usar la Service Role Key en el cliente.

### Valores de status en BD (verificados con check constraints)

**`visit_slots.status`** (sin check constraint — valores reales usados por Edge Functions):
`Available` | `Pending to confirm` | `Confirmed` | `Canceled by owner` | `Canceled by visitor` | `Not available` | `Completed`

**`offers.status`** (check constraint en BD):
`Presented` | `Accepted` | `Denied`

**`offers.initiated_by`** (check constraint en BD):
`Buyer` | `Owner`

---

## Deploy — Pipeline automático

- **PWA:** push a GitHub → Vercel redespliega automáticamente
- **Edge Functions:** push a GitHub → GitHub Actions redespliega automáticamente (`.github/workflows/deploy.yml`)
- **Supabase CLI:** instalada y vinculada al proyecto (`supabase link`)
- **Para desplegar manualmente:** `supabase functions deploy <nombre-función>`

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
| `create-user` | HTTP POST desde Salesforce Flow 1 | ✅ Completada + mejorada |
| `send-welcome-email` | Llamada interna desde create-user | ✅ Completada |
| `generate-slots` | Cron día 20 de cada mes + manual | ✅ Completada |
| `cleanup-slots` | Cron diario 02:00 | ✅ Completada |
| `get-available-slots` | HTTP GET desde Agente WhatsApp | ✅ Completada |
| `request-visit-slot` | HTTP POST desde Agente WhatsApp | ✅ Completada |
| `get-conversation-history` | HTTP GET desde Agente IA | ✅ Completada |
| `save-message` | HTTP POST desde Agente IA | ✅ Completada |
| `notify-visit` | HTTP POST desde PWA (CV confirma/cancela visita) | ✅ Completada |
| `complete-visits` | Cron diario 23:00 | ⬜ Pendiente (B11) |
| `cancel-visit-by-visitor` | HTTP POST desde Make (WhatsApp) | ⬜ Pendiente (B6) |
| `visit-reminders` | Cron diario 09:00 | ⬜ Pendiente (B7) |
| `manage-offer` | HTTP POST desde PWA (acción del CV sobre oferta) | ⬜ Pendiente (B9) |
| `create-offer` | HTTP POST desde Agente WhatsApp vía Make | ⬜ Pendiente (B9) |
| `chat-with-hero` | HTTP POST desde PWA | ⬜ Pendiente (B10) |

### Variables de entorno en Supabase (secrets)
- `RESEND_API_KEY` — para send-welcome-email
- `PWA_BASE_URL` — URL de la PWA para redirect del Magic Link (`https://app.herohome.es`)
- `MAKE_WEBHOOK_NOTIFY_VISIT` — webhook Make Escenario 3 (visitas)

---

## Make.com — Escenarios

| # | Escenario | Estado |
|---|-----------|--------|
| 1 | Formulario Web → Lead en Salesforce | ✅ Activo |
| 2 | Email Idealista → WhatsApp al PC | ⬜ Pendiente (B5) |
| 3 | Notificación visita al PC → Gmail | ✅ Activo |
| 4 | Recordatorio visita 24h → Gmail | ⬜ Pendiente (B7) |
| 5 | Decisión oferta al PC → Gmail | ⬜ Pendiente (B9) |
| 6 | Post-visita feedback → Gmail + WhatsApp | ⬜ Pendiente (B11) |

---

## Estado del proyecto (actualizado 28 mayo 2026)

**B0 — Fundamentos: 🔄 EN CURSO**
- ✅ Tablas Supabase, RLS, Auth, GitHub, Named Credentials SF, DPA OpenAI.
- 🔄 WhatsApp Cloud API y webhook — en curso.

**B1 — Activación CV: ✅ COMPLETADO**

**B2 — PWA Esqueleto: ✅ COMPLETADO**
- ✅ Proyecto Vite + React + TS + Tailwind.
- ✅ Magic Link, Layout, Mi Vivienda (lectura), Service Worker.
- ✅ Deploy en Vercel con `vercel.json` (fix rutas SPA).
- ✅ GitHub Actions para deploy automático de Edge Functions.

**B3 — Mi Vivienda Edición: ✅ COMPLETADO**

**B4 — Disponibilidad y Slots: ✅ COMPLETADO**

**B5 — Agente WhatsApp + Visitas: 🔄 EN CURSO**
- ✅ Edge Functions: get-available-slots, request-visit-slot, get-conversation-history, save-message.
- ✅ PWA: sección Visitas pendientes (Confirmar/Cancelar) + Próximas visitas + Reagendar.
- ✅ Edge Function notify-visit desplegada y conectada desde useVisits.ts.
- ✅ Make Escenario 3 activo (email al PC al confirmar/cancelar visita).
- ⬜ Make Escenario 2 (Idealista → WhatsApp) — pendiente junior.
- ⬜ Agente GPT-4o en Make + flujo RGPD — pendiente.
- ⬜ Validación end-to-end completa.

**B6 — Reagendado PC: ⬜ PENDIENTE**

**B7 — Reagendado CV + Recordatorios: ⬜ PENDIENTE**
- ✅ PWA: sección Próximas visitas con botón Reagendar + validación 24h (ya implementado en B5).
- ⬜ Edge Function visit-reminders + Make Escenario 4.

**B8 — Dashboard Operaciones: ⬜ PENDIENTE**

**B9 — Gestión de Ofertas: ⬜ PENDIENTE** ← **PRÓXIMO PASO**
- ✅ PWA: pantalla Mis Ofertas con Aceptar/Rechazar/Contraofertar (ya implementado).
- ⬜ Edge Function manage-offer + Make Escenario 5.
- ⬜ Tool create_offer en agente WhatsApp.

**B10 — Agente Hero PWA: ⬜ PENDIENTE**
- ✅ Componente chat + historial persistente (ya implementado).
- ⬜ Edge Function chat-with-hero.

**B11 — Post-visita y Feedback: ⬜ PENDIENTE**

**B12 — QA y Lanzamiento: ⬜ PENDIENTE**

---

## Correcciones aplicadas en sesión 28 mayo 2026

- Eliminadas llamadas prohibidas a `update-property-to-sf` y `update-offer-to-sf` (v2.0).
- SPEC y ARCHITECTURE actualizados con valores reales de BD (PascalCase en status).
- `vercel.json` creado (fix 404 en rutas directas de la SPA).
- `create-user` renombrado desde `create-user-and-property`, código sincronizado con producción, INSERT → upsert.
- GitHub Actions configurado (deploy automático Edge Functions en cada push).
- `notify-visit` Edge Function creada, desplegada y conectada desde `useVisits.ts`.
- Make Escenario 3 configurado y activo.

---

## Tareas completadas fuera de Claude Code

1. Configuración Supabase (tablas, RLS, Auth) — via Supabase Dashboard.
2. Configuración Salesforce (campos custom, Named Credentials, Connected App, Flow 1) — via SF UI.
3. Supabase Cron (generate-slots día 20 + cleanup-slots diario) — SQL en Supabase SQL Editor.
4. Decisión arquitectónica v3.0 — eliminación integraciones bidireccionales SF ↔ Supabase.
5. Migración de Lovable a Claude Code.
6. Diseño visual (DESIGN.md) — sistema de diseño en Google Drive.

---

## Documentos de referencia

- `ARCHITECTURE_V3_DECISIONS.md` — decisiones arquitectónicas v3.0 (en este repo).
- `docs/SPEC` — especificación técnica completa (en este repo).
- Plan de tareas v3.0 — Google Sheets (55 tareas): https://docs.google.com/spreadsheets/d/1YnsJeD4oQZI4A1T2-hNWZJidYlDFjdqQ/edit
- Arquitectura Técnica v3.0, DESIGN.md, modelos de datos — Google Drive.

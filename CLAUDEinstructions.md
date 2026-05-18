# Herohome PWA

## WHY
PWA móvil para propietarios de vivienda (CV - Cliente Vendedor) que venden su inmueble con Herohome.
Les permite gestionar su vivienda, calendario de visitas, ofertas recibidas y chatear con un agente IA.
El backend es Supabase (ya desplegado). El CRM es Salesforce (ya existente). Este repo es SOLO el frontend PWA.

## WHAT
- React 18 + TypeScript + Vite + Tailwind CSS
- @supabase/supabase-js para autenticación (Magic Link) y datos
- React Router v6 para navegación
- vite-plugin-pwa para Service Worker y manifest.json
- Desplegado en Vercel desde este repo

## HOW

### Commands
- `npm run dev` — servidor de desarrollo (puerto 5173)
- `npm run build` — build de producción
- `npm run preview` — previsualizar build
- `npm run lint` — ESLint

### Architecture
```
src/
├── components/       # Componentes reutilizables (Button, Card, Modal, Toast)
├── pages/            # Páginas principales (Login, Home, Property, Calendar, Offers)
├── layouts/          # MainLayout con sidebar y header
├── hooks/            # Custom hooks (useAuth, useProperty, useVisits, useOffers)
├── lib/              # supabaseClient.ts, tipos, utilidades
├── context/          # AuthContext
└── main.tsx          # Entry point con router
```

### Code style
- TypeScript strict, no `any`
- Named exports, no default exports (excepto páginas para lazy loading)
- Tailwind utility classes, no CSS custom files
- Hooks para lógica de datos, componentes para UI
- Nombres de archivo: PascalCase para componentes, camelCase para hooks/utils

### Supabase
- URL: https://zqkvcphtqmibttgnivku.supabase.co
- La anon key está en .env como VITE_SUPABASE_ANON_KEY
- Auth: Magic Link (email). Sesiones de 7 días.
- RLS está activado: cada usuario solo ve sus propios datos (filtro por auth.uid())
- NUNCA uses la Service Role Key en el cliente. Solo anon key.

- ## Arquitectura v3.0

- La arquitectura vigente es la v3.0. Lee ARCHITECTURE_V3_DECISIONS.md antes de proponer funcionalidades o crear Edge Functions.
- No crear Edge Functions de sincronización con Salesforce (update-property-to-sf, update-offer-to-sf, confirm-visit-to-sf, sync-offer-from-sf). Corresponden a v2.0 y están eliminadas.
- Supabase es la fuente de verdad operativa para visitas, ofertas y propiedades. Salesforce solo se usa para onboarding (Lead → Account → Contact) y contratos.
- Notificaciones al PC: siempre vía webhook a Make → Gmail. Nunca vía Salesforce Flows.
- Email de bienvenida al CV: vía Edge Function + Resend (no Make).

### Reglas importantes
- NUNCA commitees .env ni secrets
- Las Edge Functions de Supabase NO están en este repo — están desplegadas aparte
- Toda la lógica de negocio compleja (sincronizar con Salesforce, enviar emails, IA) la hacen las Edge Functions. La PWA solo hace fetch a Supabase directamente (tablas) o a Edge Functions (acciones).
- El idioma de la UI es ESPAÑOL
- La app es mobile-first (diseña primero para 375px, luego adapta a desktop)
- Consulta docs/SPEC.md para la especificación técnica completa de cada fase

## Proyecto Herohome — Contexto General

### Qué es Herohome
Herohome es la primera agencia inmobiliaria 100% digital de España. Permite a propietarios vender su vivienda sin intermediarios tradicionales, asistidos por un agente de IA llamado **Hero**. Comisión: 1% al vendedor (primera vivienda gratis) + 1% al comprador. Web corporativa: herohome.es (Webflow).

### Actores del sistema
- **PV** (Prospecto Vendedor): propietario interesado, sin contrato. No accede a la PWA.
- **CV** (Cliente Vendedor): propietario con contrato firmado. Accede a la PWA.
- **PC** (Prospecto Comprador): interesado en comprar. Interactúa solo vía WhatsApp.
- **CC** (Cliente Comprador): PC cuya oferta fue aceptada.
- **Hero**: agente IA (GPT-4o). Dos instancias: Agente PWA (asiste al CV) y Agente WhatsApp (atiende al PC).
- **Agente Herohome**: persona humana. Tareas no automatizables (llamadas, publicación en portales, firma de contratos). Usa el Dashboard de Operaciones.

### Stack tecnológico completo
| Capa | Tecnología |
|------|-----------|
| Web corporativa | Webflow (herohome.es) |
| CRM | Salesforce Enterprise (1 licencia) + Docs Made Easy + Sign Made Easy |
| PWA Frontend (CV) | React 18 + Vite + TypeScript + Tailwind CSS (este repo) |
| Dashboard Operaciones | React + Vite + TS + Tailwind + Supabase Realtime (repo separado) |
| Backend / BD | Supabase (PostgreSQL + Auth + Edge Functions + Storage) |
| Orquestación | Make.com + Supabase Cron |
| Email transaccional (CV) | Edge Function + Resend |
| Email operativo (PC) | Make.com + Gmail Workspace (hola@herohome.es, DKIM/DMARC) |
| WhatsApp | WhatsApp Cloud API (Meta) |
| IA | OpenAI GPT-4o via API (function calling) |
| Hosting | Vercel (auto-deploy desde GitHub) |
| Firma digital | Sign Made Easy (AppExchange SF) |
| Contratos | Docs Made Easy (AppExchange SF) |

### Principio arquitectónico v3.0 — Separación de responsabilidades
- **Salesforce** = sistema de registro legal y contractual (Leads, Accounts, Contacts, contratos, firma digital).
- **Supabase** = sistema operativo de la venta (visitas, ofertas, ediciones de propiedad, conversaciones, notificaciones).
- Los datos fluyen de SF a Supabase **una sola vez** (al crear usuario/propiedad via `create-user-and-property`). A partir de ahí, Supabase es la fuente de verdad operativa.
- **NO existen integraciones bidireccionales SF ↔ Supabase** en v3.0. Se eliminaron todas.

### Modelo de datos Supabase (tablas desplegadas)
- `users` — CV autenticados. PK = auth.users.id. Campos: email, first_name, last_name, dni, phone, salesforce_contact_id, salesforce_account_id, terms_accepted_at.
- `properties` — viviendas. FK user_id → users.id. Campos: salesforce_account_id, dirección, housing_type, rooms, bathrooms, built_area, useful_surface_area, sales_price, reject_offers_below, status, etc. `sf_last_sync_at` detecta cambios del CV (si `updated_at > sf_last_sync_at`, el CV editó datos).
- `availability_config` — franjas horarias del CV (Lunes-Domingo). FK property_id → properties.id. Campo `config` (JSONB: array de {day_of_week, from_hour, to_hour, is_active}).
- `visit_slots` — slots de visita generados. FK property_id → properties.id. Status: available | pending_to_confirm | confirmed | canceled_by_owner | canceled_by_visitor | not_available | completed.
- `offers` — ofertas de compra. FK property_id → properties.id. parent_offer_id para cadena de negociación. Status: presented | accepted | denied. initiated_by: buyer | seller.
- `notifications` — notificaciones in-app para el CV. FK user_id → users.id. Campos: type, payload (JSONB), read.
- `pwa_chat_sessions` — historial de chat CV ↔ Hero en PWA. FK user_id → users.id. Campo messages (JSONB).
- `whatsapp_conversations` — historial PC ↔ Hero via WhatsApp. FK property_id → properties.id. Campo messages (JSONB).
- `consents` — consentimientos RGPD del PC. Campos: wa_phone_number, type, accepted, privacy_policy_version.

### Edge Functions de Supabase (todas)
| Función | Trigger | Estado |
|---------|---------|--------|
| `create-user-and-property` | HTTP POST desde Salesforce Flow 1 | ✅ Completada |
| `send-welcome-email` | Llamada interna desde create-user-and-property | ✅ Completada |
| `generate-slots` | Cron (día 20 de cada mes) + manual | ✅ Completada |
| `cleanup-slots` | Cron diario 02:00 | ✅ Completada (incluida en cron B4) |
| `complete-visits` | Cron diario 23:00 | ⬜ Pendiente |
| `notify-visit` | HTTP POST desde PWA (CV confirma/cancela) | ⬜ Pendiente |
| `cancel-visit-by-visitor` | HTTP POST desde Make (webhook WhatsApp) | ⬜ Pendiente |
| `visit-reminders` | Cron diario 09:00 | ⬜ Pendiente |
| `manage-offer` | HTTP POST desde PWA (acción del CV) | ⬜ Pendiente |
| `create-offer` | HTTP POST desde Agente WhatsApp (via Make) | ⬜ Pendiente |
| `get-available-slots` | HTTP GET desde Agente WhatsApp | ✅ Completada |
| `request-visit-slot` | HTTP POST desde Agente WhatsApp | ✅ Completada |
| `get-conversation-history` | HTTP GET desde Agente IA | ✅ Completada |
| `save-message` | HTTP POST desde Agente IA | ✅ Completada |
| `chat-with-hero` | HTTP POST desde PWA | ⬜ Pendiente |

### Flujo de activación del CV (ya implementado)
1. Agente Herohome convierte Lead → Account + Contact en Salesforce.
2. Agente pulsa botón «Enviar acceso a la PWA» en el Contact de SF.
3. Salesforce Flow 1 hace HTTP Callout a Edge Function `create-user-and-property`.
4. La Edge Function: crea usuario en Supabase Auth → inserta en tabla `users` → inserta en tabla `properties` → genera Magic Link → devuelve user_id y magic_link.
5. SF Flow actualiza Supabase_User_ID__c, PWA_Access_Sent__c = true, PWA_Access_Sent_Date__c = NOW().
6. Edge Function `send-welcome-email` envía email de bienvenida con el Magic Link via Resend. ✅ Completada.

### Make.com — Escenarios
| # | Escenario | Estado |
|---|-----------|--------|
| 1 | Formulario Web → Lead en Salesforce | ✅ Ya existente |
| 2 | Email Idealista → parse teléfono → WhatsApp al PC | Pendiente |
| 3 | Notificación de visita al PC (webhook desde notify-visit → Gmail + WhatsApp) | Pendiente |
| 4 | Recordatorio visita 24h antes (webhook desde visit-reminders → Gmail) | Pendiente |
| 5 | Decisión sobre oferta al PC (webhook desde manage-offer → Gmail) | Pendiente |
| 6 | Post-visita → Feedback al PC (webhook desde complete-visits → Gmail + WhatsApp) | Pendiente |

### Salesforce — Objetos relevantes
- **Lead**: captación y cualificación del PV. Campos estándar + DNI__c, Ref_Catastral__c.
- **Account** (= Vivienda): un Account por cada vivienda. 21 campos custom (Age__c, Bathrooms__c, Built_area__c, Sales_price__c, Status__c, etc.).
- **Contact** (= Propietario/CV): DNI__c, Supabase_User_ID__c, PWA_Access_Sent__c, PWA_Access_Sent_Date__c.
- **Quote y Event**: NO se sincronizan desde Supabase en v3.0. Solo uso manual opcional.

### Fuente de verdad por entidad
| Dato | Sistema maestro |
|------|----------------|
| Datos vivienda (iniciales) | Salesforce Account → se copian a Supabase al crear usuario |
| Datos vivienda (operativos) | Supabase `properties` (CV edita en PWA) |
| Visitas | Supabase `visit_slots` (única fuente, no se sincronizan a SF) |
| Ofertas | Supabase `offers` (única fuente, no se sincronizan a SF) |
| Datos del CV | Salesforce Contact → se copian a Supabase al crear usuario |
| Leads y captación | Salesforce Lead |
| Contratos y firma | Salesforce + Docs/Sign Made Easy |
| Conversaciones PWA | Supabase `pwa_chat_sessions` |
| Conversaciones WhatsApp | Supabase `whatsapp_conversations` |

### Estado del proyecto (actualizado mayo 2026)

**B0 — Fundamentos: 🔄 EN CURSO**
- ✅ Tablas Supabase creadas, RLS configurado, Auth con Magic Link, proyecto en GitHub, Named Credentials en SF, DPA OpenAI firmado.
- 🔄 Verificar número de WhatsApp Cloud API y configurar webhook — en curso.

**B1 — Activación CV: ✅ COMPLETADO**
- ✅ Edge Function `send-welcome-email` (Resend + Magic Link).
- ✅ Integrar send-welcome-email como paso final de create-user-and-property.
- ✅ Validación end-to-end: botón SF → email con Magic Link.

**B2 — PWA Esqueleto: 🔄 EN CURSO**
- ✅ Crear proyecto Vite + React + TypeScript + Tailwind CSS.
- ✅ Configurar cliente Supabase.
- ✅ Implementar flujo completo de Magic Link.
- ✅ Layout base con menú lateral.
- ✅ Pantalla Mi Vivienda: lectura de properties filtrada por usuario.
- ✅ Configurar Service Worker y manifest.json para PWA.
- 🔄 Deploy en Vercel conectado a GitHub — en curso.

**B3 — Mi Vivienda Edición: ✅ COMPLETADO**
- ✅ Habilitar edición del formulario Mi Vivienda en la PWA.
- ✅ Botón Guardar: actualizar properties en Supabase + updated_at.

**B4 — Disponibilidad y Slots: ✅ COMPLETADO**
- ✅ Pantalla «Configurar disponibilidad» en PWA.
- ✅ Edge Function generate-slots.
- ✅ Configurar Supabase Cron: generate-slots día 20 + cleanup-slots diario.
- ✅ Validar generación correcta de slots en visit_slots.

**B5 — Agente WhatsApp + Visitas: 🔄 EN CURSO**
- ✅ Edge Functions: get-available-slots, request-visit-slot.
- ✅ Edge Functions: get-conversation-history, save-message.
- ⬜ Configurar Make Escenario 2: parsing email Idealista → WhatsApp al PC.
- ⬜ Implementar agente GPT-4o en Make: system prompt + tools.
- ⬜ Desarrollar flujo RGPD de consentimiento en el agente.
- ⬜ En la PWA: sección «Visitas pendientes» con Confirmar/Cancelar.
- ⬜ Edge Function: notify-visit.
- ⬜ Configurar Make Escenario 3.
- ⬜ Diseñar plantillas de email de confirmación/cancelación de visita.
- ⬜ Validar flujo completo end-to-end.

**B6 a B12: ⬜ PENDIENTES** — Todas las tareas pendientes. Ver plan de tareas en `Herohome_Plan_Tareas_v3.xlsx` para detalle.

### Tareas completadas fuera de Claude Code (contexto que Claude Code NO tiene)
Las siguientes tareas se realizaron via chat de Claude (claude.ai) o manualmente, y Claude Code no las ejecutó ni tiene visibilidad de ellas:
1. **Toda la configuración de Supabase (B0)**: creación de tablas, RLS, Auth, variables de entorno — hecho via Supabase Dashboard siguiendo instrucciones de chat.
2. **Configuración de Salesforce**: campos custom en Account/Contact, Named Credentials, Connected App con OAuth 2.0, Record Type Property — hecho en Salesforce UI.
3. **Salesforce Flow 1** (botón «Enviar acceso a la PWA»): configurado en Salesforce UI.
4. **Edge Function `create-user-and-property`**: desarrollada con guía del chat, desplegada via Supabase CLI. URL: `https://zqkvcphtqmibttgnivku.supabase.co/functions/v1/create-user`. Crea usuario en Auth, inserta en `users` y `properties`, genera Magic Link.
5. **Validación end-to-end B1**: botón SF → email con Magic Link probado y validado manualmente.
6. **Configuración Supabase Cron (B4)**: generate-slots día 20 + cleanup-slots diario — SQL ejecutado en Supabase SQL Editor.
7. **Validación de slots B4**: generación correcta verificada manualmente en visit_slots.
8. **Decisión arquitectónica v3.0**: eliminación de todas las integraciones bidireccionales SF ↔ Supabase. Documentada en `ARCHITECTURE_V3_DECISIONS.md`.
9. **Migración de Lovable a Claude Code**: decisión de abandonar Lovable y reconstruir la PWA con Claude Code.
10. **Diseño visual (DESIGN.md)**: sistema de diseño completo con paleta de colores, tipografía, componentes. Logo "Pulse" con dos barras verticales violetas asimétricas. Color primario: #5B5CFF.

### Documentos de referencia del proyecto
- `ARCHITECTURE_V3_DECISIONS.md` — decisiones arquitectónicas v3.0 (en el repo).
- `docs/SPEC.md` — especificación técnica completa de cada fase (en el repo).
- **Arquitectura Técnica v3.0** — documento completo en Google Drive (Herohome_Arquitectura_Tecnica_v3_0.docx).
- **DESIGN.md** — sistema de diseño y brand guidelines en Google Drive.
- **Modelo de datos Salesforce** — spreadsheet en Google Drive.
- **Modelo de datos Supabase** — spreadsheet en Google Drive.
- **Plan de tareas v3.0** — spreadsheet con 55 tareas, tracks paralelos y resumen de delegación.

### Reglas que Claude Code debe respetar
- La arquitectura vigente es la **v3.0**. Leer `ARCHITECTURE_V3_DECISIONS.md` antes de proponer funcionalidades.
- **NO crear Edge Functions de sincronización con Salesforce** (update-property-to-sf, update-offer-to-sf, confirm-visit-to-sf, sync-offer-from-sf). Pertenecen a v2.0 y están eliminadas.
- Supabase es la fuente de verdad operativa. Salesforce solo para onboarding y contratos.
- Notificaciones al PC: siempre via webhook a Make → Gmail. Nunca via Salesforce Flows.
- Email de bienvenida al CV: via Edge Function + Resend (no Make).
- La UI es en **español**. Mobile-first (375px primero).
- Diseño: Inter como única fuente. Color primario #5B5CFF. Sin box-shadows para elevación (usar bordes). Stripe/Linear aesthetic.
- El agente IA se llama **Hero** (no "el bot", "la IA", "el agente").
- Naming: **Herohome** (capital H solo, nunca HeroHome ni HEROHOME).

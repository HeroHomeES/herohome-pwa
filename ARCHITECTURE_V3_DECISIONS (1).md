# ARCHITECTURE_V3_DECISIONS.md

> **Este archivo es la referencia autoritativa para Claude Code.**
> La arquitectura vigente es la **v3.0**. Cualquier referencia en el código, comentarios o documentación a Edge Functions, Salesforce Flows o integraciones que aparezcan como "ELIMINADAS" en este documento debe ignorarse o eliminarse.

---

## Principio arquitectónico v3.0

**Salesforce es el sistema de registro legal y contractual. Supabase es el sistema operativo de la venta.**

Los datos fluyen de Salesforce a Supabase **una sola vez** (al crear el usuario y la propiedad mediante el Flow 1 + Edge Function `create-user-and-property`). A partir de ese momento, Supabase es la fuente de verdad para todo lo operativo: visitas, ofertas, ediciones de propiedad, conversaciones y notificaciones.

No existen integraciones bidireccionales entre Supabase y Salesforce. El flujo es unidireccional: SF → Supabase (solo en la activación del CV).

---

## Cambios de v2.0 a v3.0

### 1. EDGE FUNCTIONS ELIMINADAS — NO DESARROLLAR

Estas Edge Functions estaban planificadas en v2.0 y **no deben crearse**:

| Edge Function | Qué hacía en v2.0 | Por qué se elimina |
|---|---|---|
| `confirm-visit-to-sf` | Al confirmar visita en PWA, creaba un Event en Salesforce | El agente humano ve visitas en el Dashboard, no en SF |
| `update-offer-to-sf` | Al aceptar/rechazar/contraofertar, actualizaba la Quote en Salesforce | Las ofertas viven solo en Supabase |
| `sync-offer-from-sf` | Recibía Quotes creadas en SF y las insertaba en tabla offers de Supabase | Las ofertas se crean directamente en Supabase |
| `update-property-to-sf` | Al editar vivienda en PWA, sincronizaba cambios al Account de Salesforce | El agente ve cambios en el Dashboard y actualiza portales manualmente |

**Si en el código encuentras imports, referencias, stubs o TODOs relacionados con estas funciones, elimínalos.**

### 2. SALESFORCE FLOWS ELIMINADOS

| Flow | Qué hacía en v2.0 | Estado en v3.0 |
|---|---|---|
| Flow 1 (botón "Enviar acceso PWA") | HTTP Callout a `create-user-and-property` | **SE MANTIENE** — único punto de integración SF → Supabase |
| Flow 2 (Quote sync a Supabase) | Cuando se creaba/modificaba una Quote en SF, hacía HTTP Callout para sincronizar a tabla offers | **ELIMINADO** — las ofertas se crean directamente en Supabase |
| Flow 3 (Notificar decisión del CV) | Cuando el CV aceptaba/rechazaba en PWA, el update viajaba a SF y un Flow disparaba Make para notificar al PC | **ELIMINADO** — la Edge Function `manage-offer` llama directamente a un webhook de Make |

### 3. OFERTAS — Flujo completamente rediseñado

**v2.0 (OBSOLETO):**
```
PC hace oferta vía WhatsApp
  → Agente WA → create_offer → crea Quote en Salesforce
    → SF Flow 2 sincroniza Quote a tabla offers de Supabase
      → PWA del CV muestra la oferta

CV acepta/rechaza/contraoferta en PWA
  → Edge Function update-offer-to-sf → actualiza Quote en SF
    → SF Flow 3 → Make Escenario 5 → email al PC
```

**v3.0 (VIGENTE):**
```
PC hace oferta vía WhatsApp
  → Agente WA → Edge Function create-offer → INSERT en tabla offers de Supabase
    → Se crea notification para el CV
      → PWA del CV muestra la oferta

CV acepta/rechaza/contraoferta en PWA
  → Edge Function manage-offer:
    - Acepta: offers.status = 'accepted'
    - Rechaza: offers.status = 'denied'
    - Contraoferta: offers.status = 'denied' + INSERT nueva oferta con initiated_by = 'seller'
  → Misma Edge Function llama webhook de Make
    → Make envía email al PC vía Gmail
```

**Implicaciones para el código:**
- La tabla `offers` es la fuente de verdad única. El campo `salesforce_quote_id` es **nullable** y no se usa en v3.0.
- La tool `create_offer` del agente WhatsApp crea la oferta en Supabase (no en SF). El parámetro es `property_id` (no `account_id`).
- La PWA muestra ofertas con lectura Y escritura (aceptar, rechazar, contraofertar).
- No existe sincronización con Salesforce Quote en ninguna dirección.

### 4. VISITAS — Sin sincronización con Salesforce

**v2.0:** Al confirmar una visita, se creaba un Event en Salesforce para que el agente lo viera en su calendario.

**v3.0:** La visita vive solo en `visit_slots` de Supabase. Al confirmar:
- Edge Function `notify-visit` llama a un webhook de Make
- Make envía WhatsApp + email de confirmación al PC vía Gmail
- El Dashboard del agente se actualiza en tiempo real (Supabase Realtime)
- **No se crea Event en Salesforce**

El campo `salesforce_event_id` en la tabla `visit_slots` es **legacy y no se usa**. No escribir en él.

### 5. EDICIÓN DE PROPIEDAD — Sin sincronización con Salesforce

**v2.0:** El botón "Guardar" en Mi Vivienda actualizaba Supabase y luego llamaba a `update-property-to-sf` para sincronizar al Account de SF.

**v3.0:** El botón "Guardar" actualiza solo Supabase (`properties` + `updated_at`). No hay sincronización automática a Salesforce. El agente humano ve los cambios en el Dashboard (comparando `updated_at` vs `sf_last_sync_at`).

### 6. EMAILS OPERATIVOS — Nuevo routing

| Tipo de email | Destinatario | v2.0 | v3.0 |
|---|---|---|---|
| Bienvenida + Magic Link | CV | Edge Function + Resend | **Sin cambios** — Edge Function + Resend |
| Confirmación de visita | PC | Dependía de Event en SF → Make | **Edge Function notify-visit → webhook Make → Gmail** |
| Recordatorio 24h | CV + PC | No existía | **NUEVO: Cron Supabase → Edge Function visit-reminders → webhook Make → Gmail** |
| Decisión sobre oferta | PC | SF Flow 3 → Make → Gmail | **Edge Function manage-offer → webhook Make → Gmail** |
| Post-visita / Feedback | PC | Sin cambios relevantes | **Cron Supabase → Edge Function complete-visits → webhook Make → Gmail + WhatsApp** |

Regla general: todos los emails al PC salen por **Make + Gmail** (hola@herohome.es con DKIM/DMARC). El email de bienvenida al CV sale por **Edge Function + Resend**.

### 7. NUEVAS EDGE FUNCTIONS (v3.0)

Estas funciones son nuevas y deben desarrollarse:

| Edge Function | Trigger | Qué hace |
|---|---|---|
| `notify-visit` | HTTP POST desde PWA (CV confirma/cancela) | Llama webhook de Make para notificar al PC |
| `manage-offer` | HTTP POST desde PWA (CV acepta/rechaza/contraoferta) | Actualiza offers en Supabase + llama webhook de Make |
| `create-offer` | HTTP POST desde Agente WhatsApp (vía Make) | Crea registro en tabla offers + notification para CV |
| `visit-reminders` | Scheduled (cron diario, 09:00) | Consulta visitas confirmadas para mañana, llama webhook de Make |
| `complete-visits` | Scheduled (cron diario, 23:00) | Marca como completed los slots con end_time < now() AND status=confirmed |

### 8. DASHBOARD DE OPERACIONES — Nuevo componente

Nueva aplicación web (React + Vite + TypeScript + Tailwind + Supabase) para el agente humano de Herohome. Desplegada en Vercel (admin.herohome.es).

**Autenticación:** usuario admin en Supabase Auth con `role: "admin"` en user_metadata. Políticas RLS con SELECT en tablas operativas para role = admin.

**Pantallas:**
- Panel principal: resumen KPIs + alertas en tiempo real
- Viviendas: listado con indicador de "campos modificados" (updated_at > sf_last_sync_at)
- Visitas: vista calendario + lista filtrable por estado
- Ofertas: cadena de negociación visual (usando parent_offer_id)
- Conversaciones WhatsApp: solo lectura

**Supabase Realtime** para actualizar automáticamente cuando cambian visit_slots, offers o properties.

### 9. NUEVO STATUS DE VISITA

Se añade el status `completed` a visit_slots. Asignado automáticamente por el cron `complete-visits` cuando `end_time < now() AND status = 'confirmed'`.

Lista completa de estados de visit_slots:
- `available` — slot disponible para reserva
- `pending_to_confirm` — PC ha solicitado, CV no ha confirmado
- `confirmed` — CV ha confirmado la visita
- `canceled_by_owner` — CV ha cancelado
- `canceled_by_visitor` — PC ha cancelado
- `not_available` — slot pasado no usado
- `completed` — visita realizada (NUEVO v3.0)

---

## Fuente de verdad por entidad

| Dato | Sistema maestro | Notas |
|---|---|---|
| Datos de vivienda (iniciales) | Salesforce Account | Se copian a Supabase una vez al crear |
| Datos de vivienda (operativos) | **Supabase properties** | El CV los edita en PWA. No se sincronizan a SF. |
| Visitas | **Supabase visit_slots** | Única fuente. No hay Events en SF. |
| Ofertas | **Supabase offers** | Única fuente. No hay Quotes en SF. |
| Datos del CV | Salesforce Contact | Se copian a Supabase una vez al crear. |
| Leads y captación | Salesforce Lead | Sin cambios. |
| Contratos y firma | Salesforce + Docs/Sign Made Easy | Sin cambios. |
| Conversaciones PWA | Supabase pwa_chat_sessions | Exclusivo Supabase. |
| Conversaciones WhatsApp | Supabase whatsapp_conversations | Exclusivo Supabase. |
| Configuración disponibilidad | Supabase availability_config | Exclusivo Supabase. |
| Notificaciones | Supabase notifications | Exclusivo Supabase. |
| Consentimientos RGPD | Supabase consents | Exclusivo Supabase. |

---

## Lo que SE MANTIENE en Salesforce

1. Gestión de Leads (captación, cualificación, conversión a Account + Contact)
2. Generación de contratos (Docs Made Easy)
3. Firma digital (Sign Made Easy)
4. Flow 1: botón "Enviar acceso a la PWA" → HTTP Callout a `create-user-and-property`
5. Account y Contact como registro maestro de la relación contractual
6. Named Credential para autenticación del HTTP Callout

---

## Reglas para Claude Code

1. **No crear** Edge Functions que sincronicen datos a Salesforce (confirm-visit-to-sf, update-offer-to-sf, sync-offer-from-sf, update-property-to-sf). Estas corresponden a v2.0 y están obsoletas.
2. **No escribir** en los campos `salesforce_event_id` (visit_slots) ni `salesforce_quote_id` (offers). Son legacy nullable.
3. **Ofertas**: la fuente de verdad es la tabla `offers` de Supabase. No crear Quotes en Salesforce.
4. **Visitas**: la fuente de verdad es la tabla `visit_slots` de Supabase. No crear Events en Salesforce.
5. **Edición de propiedad**: guardar solo en Supabase. No sincronizar a SF Account.
6. **Notificaciones al PC**: siempre vía webhook a Make (que envía por Gmail/WhatsApp). Nunca vía Salesforce Flows.
7. **Email de bienvenida al CV**: vía Edge Function + Resend (no Make).
8. **Dashboard**: aplicación separada de la PWA, mismo proyecto Supabase, autenticación con role admin.

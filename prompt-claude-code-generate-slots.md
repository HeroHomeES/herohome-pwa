# Tarea: Desarrollar Edge Function generate-slots

## Contexto

Esta Edge Function genera los slots de visita (tabla `visit_slots`) para las próximas 4 semanas, basándose en la configuración de disponibilidad que cada propietario (CV) ha guardado en la tabla `availability_config`.

Se invoca de dos formas:
1. **Manualmente desde la PWA**: cuando el CV guarda su disponibilidad, la PWA llama a esta función para regenerar los slots inmediatamente.
2. **Vía Supabase Cron**: el día 20 de cada mes a las 00:00, para generar los slots del mes siguiente automáticamente.

## Ubicación

```
supabase/functions/generate-slots/index.ts
```

## Esquema de tablas relevantes

### availability_config
```
id            uuid     PK
property_id   uuid     FK → properties.id, UNIQUE
config        jsonb    Array de objetos (ver formato abajo)
updated_at    timestamptz
```

**Formato del campo `config` (IMPORTANTE — la PWA ya guarda en este formato):**
```json
[
  { "day_of_week": 0, "from_hour": 10, "to_hour": 14, "is_active": true },
  { "day_of_week": 1, "from_hour": 10, "to_hour": 14, "is_active": true },
  { "day_of_week": 2, "from_hour": 10, "to_hour": 14, "is_active": false },
  { "day_of_week": 3, "from_hour": 17, "to_hour": 20, "is_active": true },
  { "day_of_week": 4, "from_hour": 17, "to_hour": 20, "is_active": true },
  { "day_of_week": 5, "from_hour": 10, "to_hour": 13, "is_active": true },
  { "day_of_week": 6, "from_hour": 10, "to_hour": 13, "is_active": false }
]
```
- `day_of_week`: 0 = Lunes, 1 = Martes, ..., 6 = Domingo
- `from_hour` y `to_hour`: horas completas (0-23)
- `is_active`: si ese día está habilitado para visitas
- Los slots se generan en bloques de **1 hora** entre from_hour y to_hour

### visit_slots
```
id              uuid          PK, default gen_random_uuid()
property_id     uuid          FK → properties.id
start_time      timestamptz   NOT NULL
end_time        timestamptz   NOT NULL
status          text          Nullable — valores posibles: available, pending_to_confirm, confirmed, canceled_by_owner, canceled_by_visitor, not_available, completed
visitor_name    text          Nullable
visitor_last_name text        Nullable
visitor_phone   text          Nullable
visitor_dni     text          Nullable
visitor_email   text          Nullable
consent_given   bool          Nullable
consent_at      timestamptz   Nullable
created_at      timestamptz   default now()
updated_at      timestamptz   default now()
```

### properties
```
id              uuid    PK
user_id         uuid    FK → users.id
status          text    Nullable — valores: On Sale, Sold, Contract cancelled
...otros campos
```

## Lógica de la función

### Modo 1: Llamada HTTP POST (desde la PWA o desde otra Edge Function)

**Request:**
```
POST /functions/v1/generate-slots
Headers:
  Authorization: Bearer <service_role_key o JWT del usuario>
  Content-Type: application/json
Body:
  { "property_id": "uuid-de-la-propiedad" }
```

Cuando recibe un `property_id` específico:
1. Buscar la availability_config de esa propiedad.
2. Eliminar todos los slots FUTUROS con status = 'available' de esa propiedad (no tocar los que tienen otro status: pending_to_confirm, confirmed, etc.).
3. Generar slots nuevos para las **próximas 4 semanas** desde hoy.

### Modo 2: Llamada HTTP POST sin body (desde Cron)

Cuando se invoca sin `property_id` (o con body vacío):
1. Buscar TODAS las availability_config cuya propiedad tenga status = 'On Sale'.
2. Para cada una, eliminar slots futuros con status = 'available' de esa propiedad.
3. Generar slots nuevos para las **próximas 4 semanas** desde hoy.

### Algoritmo de generación de slots

```
Para cada día de las próximas 4 semanas (28 días desde hoy):
  1. Determinar qué day_of_week corresponde (0=Lunes, 1=Martes, ..., 6=Domingo)
     NOTA: En JavaScript, getDay() devuelve 0=Domingo.
     Convertir: JS_day_of_week = (jsGetDay() + 6) % 7 para que 0=Lunes
  2. Buscar en el array config si hay una entrada para ese day_of_week con is_active = true
  3. Si la hay, para cada hora H desde from_hour hasta to_hour - 1:
     - start_time = ese día a las H:00 en zona horaria Europe/Madrid
     - end_time = start_time + 1 hora
     - Insertar en visit_slots con status = 'available'
     - Usar ON CONFLICT DO NOTHING para no duplicar (ver nota abajo)
```

### Zona horaria

CRÍTICO: Todas las horas se interpretan en **Europe/Madrid** (CET/CEST). La base de datos almacena en UTC (timestamptz), así que hay que hacer la conversión correctamente.

Ejemplo: si el CV configura "Lunes de 10:00 a 14:00", los slots serían:
- En verano (CEST, UTC+2): 08:00 UTC, 09:00 UTC, 10:00 UTC, 11:00 UTC
- En invierno (CET, UTC+1): 09:00 UTC, 10:00 UTC, 11:00 UTC, 12:00 UTC

Para manejar esto correctamente, construir la fecha-hora en Europe/Madrid y dejar que PostgreSQL haga la conversión a UTC. Usar un approach tipo:

```typescript
// Construir fecha en Europe/Madrid
const dateStr = `${year}-${month}-${day}T${hour.toString().padStart(2,'0')}:00:00`;
// Insertar usando AT TIME ZONE para que Supabase almacene en UTC
// O usar la librería Temporal / Intl.DateTimeFormat para la conversión
```

### Evitar duplicados

Usar una combinación única de (property_id, start_time) para evitar duplicados. Hay dos opciones:

**Opción A (preferida):** Antes de insertar, borrar todos los slots futuros con status = 'available' de esa propiedad, y luego insertar los nuevos. Esto es limpio porque:
- No toca slots con otro status (pending, confirmed, etc.)
- Regenera limpiamente según la config actual

**Opción B:** Usar un UNIQUE constraint en (property_id, start_time) y ON CONFLICT DO NOTHING. Esto es más defensivo pero puede dejar slots "huérfanos" si el CV cambió su disponibilidad (ej: antes tenía lunes 10-14, ahora lunes 10-12 → los slots de 12:00 y 13:00 del lunes quedarían).

**Recomendación: usar Opción A** — borrar available futuros primero, luego insertar.

### Respuesta

```json
// Éxito
{
  "success": true,
  "properties_processed": 1,
  "slots_created": 48,
  "slots_deleted": 12
}

// Error
{
  "error": "descripción del error"
}
```

## Seguridad

- La función usa **Service Role Key** (no la anon key) porque necesita acceder a availability_config y properties sin restricción RLS.
- Las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya están disponibles en el entorno de Supabase Edge Functions (no hay que configurarlas manualmente).
- Si se invoca con un JWT de usuario (desde la PWA), verificar que el property_id pertenece al usuario autenticado antes de procesar.

## Código de referencia — Estructura

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface AvailabilityEntry {
  day_of_week: number; // 0=Lunes, 6=Domingo
  from_hour: number;
  to_hour: number;
  is_active: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Parsear body (puede estar vacío para modo cron)
  let propertyId: string | null = null;
  try {
    const body = await req.json();
    propertyId = body.property_id ?? null;
  } catch {
    // Body vacío o inválido — modo cron, procesar todas las propiedades
  }

  // ... implementar lógica aquí
});
```

## Casos edge a manejar

1. **availability_config no existe** para una propiedad → saltar, no generar slots.
2. **config es un array vacío** o todos los días tienen is_active = false → no generar nada, pero sí borrar slots available existentes (el CV ha desactivado toda su disponibilidad).
3. **Propiedad con status distinto de "On Sale"** → en modo cron, no procesar. En modo individual (con property_id), procesar igualmente (el CV puede querer preparar la disponibilidad antes de publicar).
4. **Slots ya existentes con status != available** → NUNCA borrar ni modificar. Solo tocar los que tienen status = 'available'.
5. **Hoy es uno de los 28 días** → generar slots para hoy solo si la hora aún no ha pasado. Es decir, si hoy es martes a las 15:00 y el CV tiene martes de 10 a 18, solo generar slots de 16:00, 17:00 (no los de 10:00-15:00 que ya pasaron).

## Criterio de éxito

1. Con un property_id específico: se borran los slots available futuros y se generan nuevos según la config actual.
2. Sin property_id: se procesan todas las propiedades con status = 'On Sale'.
3. Los slots se almacenan con timestamps correctos en UTC correspondientes a Europe/Madrid.
4. No se tocan slots con status distinto de 'available'.
5. La función responde con el conteo de propiedades procesadas y slots creados/borrados.
6. La función tarda menos de 10 segundos para 50 propiedades.

## Despliegue

```bash
supabase functions deploy generate-slots --project-ref zqkvcphtqmibttgnivku
```

## Test manual

Después de desplegar, probar con:
```bash
curl -X POST https://zqkvcphtqmibttgnivku.supabase.co/functions/v1/generate-slots \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"property_id": "<uuid-de-una-propiedad-con-availability-config>"}'
```

Luego verificar en Supabase Dashboard → Table Editor → visit_slots que se han creado los slots correctamente.

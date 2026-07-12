-- 2026-07-12 — Anti-duplicados de conversaciones de WhatsApp (comprador + vivienda)
--
-- Problema: `process-idealista-lead` deduplicaba con SELECT-then-INSERT. Bajo
-- ejecuciones concurrentes (p. ej. `testRun` del Apps Script a la vez que el
-- trigger de cada minuto) dos invocaciones pasaban el SELECT antes de que ninguna
-- insertara -> se creaban DOS conversaciones para el mismo comprador+vivienda y se
-- enviaba la bienvenida DOS veces.
--
-- Solución de BD: un índice único que actúe como barrera real. `process-idealista-lead`
-- pasa a insert-then-send apoyándose en este índice (captura el 23505).
--
-- APLICACIÓN MANUAL (el MCP de Supabase es read-only). PRODUCCIÓN, sin staging.
-- Ejecutar el bloque de comprobación ANTES de crear el índice: `create unique index`
-- falla si existen duplicados.

-- ---------------------------------------------------------------------------
-- PASO 1 — Comprobar duplicados existentes (solo property_id NO NULL, que es el
-- ámbito del índice parcial de abajo). Debe devolver 0 filas para poder crear el
-- índice. El 12 jul 2026 la BD estaba limpia (duplicados de Alaquàs borrados a mano).
-- ---------------------------------------------------------------------------
select wa_phone_number, property_id, count(*) as filas
from whatsapp_conversations
where property_id is not null
group by wa_phone_number, property_id
having count(*) > 1;

-- Si el PASO 1 devuelve filas, deduplicar ANTES de crear el índice. La estrategia
-- segura conserva la conversación más "rica" (más mensajes; a igualdad, la más
-- reciente) y borra las demás del grupo. Revisar manualmente antes de ejecutar:
-- el borrado pierde el historial de las conversaciones descartadas.
--
--   with ranked as (
--     select id,
--            row_number() over (
--              partition by wa_phone_number, property_id
--              order by jsonb_array_length(messages) desc, last_message_at desc
--            ) as rn
--     from whatsapp_conversations
--     where property_id is not null
--   )
--   delete from whatsapp_conversations c
--   using ranked r
--   where c.id = r.id and r.rn > 1;

-- ---------------------------------------------------------------------------
-- PASO 2 — Índice único PARCIAL sobre (wa_phone_number, property_id) para las
-- conversaciones CON vivienda.
--
-- Por qué parcial (`where property_id is not null`):
--  - El caso reportado (comprador + vivienda) siempre tiene property_id NO NULL.
--  - Los inbounds en frío del whatsapp-agent crean conversaciones SIN vivienda
--    (property_id NULL). En un índice único normal los NULL son distintos entre sí,
--    así que no se verían afectados igualmente; y `save-message` no maneja conflicto,
--    por lo que forzar unicidad sobre el bucket NULL podría provocar errores 23505
--    (500) en esa ruta. El índice parcial deja los inbounds sin vivienda intactos.
-- ---------------------------------------------------------------------------
create unique index if not exists whatsapp_conversations_phone_property_uidx
  on whatsapp_conversations (wa_phone_number, property_id)
  where property_id is not null;

-- Verificación:
--   select indexname from pg_indexes where tablename = 'whatsapp_conversations';

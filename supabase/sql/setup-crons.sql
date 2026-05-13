-- ================================================================
-- Herohome — Cron jobs para el sistema de visitas
-- ----------------------------------------------------------------
-- Pegar en: Supabase Dashboard → SQL Editor → New query
-- Ejecutar completo de una vez (botón "Run" o Cmd+Enter)
-- ================================================================
-- ANTES DE EJECUTAR: sustituye el placeholder al final del archivo
-- ================================================================


-- ----------------------------------------------------------------
-- EXTENSIONES
-- Si ya están activas en Dashboard → Database → Extensions,
-- estas líneas no hacen nada (IF NOT EXISTS las hace idempotentes).
-- Si falla con "must be superuser", actívalas desde el Dashboard.
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;


-- ================================================================
-- CRON 1 — generate-monthly-slots
-- Día 20 de cada mes a las 00:00 UTC
-- Llama a la Edge Function generate-slots (modo cron: sin property_id)
-- para regenerar los slots de las próximas 4 semanas en todas las
-- propiedades con status = 'On Sale'.
-- ================================================================

-- Desregistrar si ya existe (hace el script idempotente)
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'generate-monthly-slots';

SELECT cron.schedule(
  'generate-monthly-slots',           -- nombre del job
  '0 0 20 * *',                       -- día 20 de cada mes, 00:00 UTC
  $$
  SELECT net.http_post(
    url     := 'https://zqkvcphtqmibttgnivku.supabase.co/functions/v1/generate-slots',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer TU_SERVICE_ROLE_KEY_AQUI'
    ),
    body    := '{}'::jsonb
  );
  $$
);


-- ================================================================
-- CRON 2 — cleanup-old-slots
-- Diario a las 02:00 UTC
-- Operación 1: Borra slots pasados que nadie reservó (Available)
-- Operación 2: Marca como 'Not available' las solicitudes de visita
--              no confirmadas cuyo horario ya expiró (Pending to confirm)
-- ================================================================

-- NOTA sobre status: la tabla usa Title Case, no snake_case.
-- Valores válidos: 'Available', 'Pending to confirm', 'Confirmed',
-- 'Canceled by owner', 'Canceled by visitor', 'Not available', 'Completed'

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'cleanup-old-slots';

SELECT cron.schedule(
  'cleanup-old-slots',
  '0 2 * * *',                        -- diario a las 02:00 UTC
  $$
  DO $body$
  BEGIN

    -- 1. Eliminar slots disponibles cuyo horario ya pasó
    DELETE FROM visit_slots
    WHERE start_time < now()
      AND status = 'Available';

    -- 2. Expirar solicitudes pendientes no confirmadas a tiempo
    UPDATE visit_slots
    SET    status     = 'Not available',
           updated_at = now()
    WHERE  end_time < now()
      AND  status   = 'Pending to confirm';

  END;
  $body$
  $$
);


-- ================================================================
-- CRON 3 — complete-visits
-- Diario a las 23:00 UTC
-- Marca como 'Completed' las visitas confirmadas que ya terminaron.
-- Se ejecuta al final del día para dar margen a la visita de 22:00.
-- ================================================================

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'complete-visits';

SELECT cron.schedule(
  'complete-visits',
  '0 23 * * *',                       -- diario a las 23:00 UTC
  $$
  UPDATE visit_slots
  SET    status     = 'Completed',
         updated_at = now()
  WHERE  end_time < now()
    AND  status   = 'Confirmed';
  $$
);


-- ================================================================
-- VERIFICACIÓN — ejecuta esto al final para confirmar el registro
-- ================================================================
SELECT
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname IN (
  'generate-monthly-slots',
  'cleanup-old-slots',
  'complete-visits'
)
ORDER BY jobname;

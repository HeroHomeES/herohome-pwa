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
-- CRON 1 — generate-daily-slots
-- Diario a las 03:00 UTC (después del cleanup de las 02:00)
-- Llama a la Edge Function generate-slots (modo cron: sin property_id)
-- para SINCRONIZAR la ventana móvil de 14 días en todas las propiedades
-- con status = 'On sale': crea los slots que falten (incluido el nuevo
-- día que entra en la ventana) y borra los 'Available' obsoletos.
-- Nunca toca reservas (Pending/Confirmed) ni slots bloqueados.
-- ================================================================

-- Desregistrar el cron mensual antiguo (obsoleto) y el diario si ya existe
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('generate-monthly-slots', 'generate-daily-slots');

SELECT cron.schedule(
  'generate-daily-slots',             -- nombre del job
  '0 3 * * *',                        -- diario a las 03:00 UTC
  $$
  SELECT net.http_post(
    url     := 'https://zqkvcphtqmibttgnivku.supabase.co/functions/v1/generate-slots',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key',    'TU_HEROHOME_API_KEY_AQUI'
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
-- Operación 3: Gate de honorarios (B13) — resetea conversaciones colgadas
--              en awaiting_fee_consent >24h (el PC no respondió al gate).
--              El slot nunca se reservó (sigue Available): solo se limpia
--              el estado de la conversación. Cron silencioso (sin aviso al PC).
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

    -- 3. Gate de honorarios (B13): resetear gates colgados >24h.
    --    El PC no respondió al mensaje de honorarios. El slot NUNCA se reservó
    --    (sigue 'Available'), así que aquí solo limpiamos el estado de la
    --    conversación. Sin aviso al PC (decisión: cron silencioso).
    UPDATE whatsapp_conversations
    SET    agent_state = NULL
    WHERE  agent_state->>'state' = 'awaiting_fee_consent'
      AND  (agent_state->>'gate_sent_at')::timestamptz < now() - interval '24 hours';

    -- 4. Dedupe del webhook de WhatsApp: purgar registros antiguos (>7 días).
    --    Guardado con to_regclass para que el cron no falle si la migración
    --    2026-07-05-team-y-webhook.sql aún no se ha aplicado.
    IF to_regclass('public.wa_processed_messages') IS NOT NULL THEN
      DELETE FROM wa_processed_messages
      WHERE received_at < now() - interval '7 days';
    END IF;

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
-- CRON 4 — visit-reminders
-- Diario a las 07:00 UTC (~09:00 Europe/Madrid; varía 1h con el horario de verano)
-- Llama a la Edge Function visit-reminders (con x-api-key) → recordatorio
-- "el día antes" de las visitas Confirmed: WhatsApp (plantilla) + email al PC,
-- y email al CV (propietario).
-- ANTES DE EJECUTAR: sustituye TU_HEROHOME_API_KEY_AQUI por el valor de HEROHOME_API_KEY.
-- ================================================================

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'visit-reminders';

SELECT cron.schedule(
  'visit-reminders',
  '0 7 * * *',                        -- diario a las 07:00 UTC (~09:00 Madrid)
  $$
  SELECT net.http_post(
    url     := 'https://zqkvcphtqmibttgnivku.supabase.co/functions/v1/visit-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key',    'TU_HEROHOME_API_KEY_AQUI'
    ),
    body    := '{}'::jsonb
  );
  $$
);


-- ================================================================
-- CRON 5 — post-visit-followup
-- Cada 30 minutos
-- Llama a la Edge Function post-visit-followup (con x-api-key) → envía el
-- mensaje post-visita ~1h después de cada visita Confirmed para invitar a
-- ofertar o recoger feedback. Idempotente vía visit_slots.post_visit_sent_at.
-- ================================================================

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'post-visit-followup';

SELECT cron.schedule(
  'post-visit-followup',
  '*/30 * * * *',                     -- cada 30 minutos
  $$
  SELECT net.http_post(
    url     := 'https://zqkvcphtqmibttgnivku.supabase.co/functions/v1/post-visit-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-api-key',    'TU_HEROHOME_API_KEY_AQUI'
    ),
    body    := '{}'::jsonb
  );
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
  'generate-daily-slots',
  'cleanup-old-slots',
  'complete-visits',
  'visit-reminders',
  'post-visit-followup'
)
ORDER BY jobname;

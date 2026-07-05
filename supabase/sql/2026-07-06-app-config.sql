-- ================================================================
-- 2026-07-06 — app_config: configuración privada para crons y
--              dead-man's-switch (Healthchecks.io)
-- ----------------------------------------------------------------
-- Aplicar manual: Supabase Dashboard → SQL Editor → Run completo.
-- APLICAR ANTES de re-ejecutar setup-crons.sql (los crons nuevos
-- leen la API key de esta tabla).
-- ================================================================

BEGIN;

-- Tabla de configuración privada. Solo service_role/postgres (RLS DENY
-- total, mismo patrón que consents). Editable desde el Table Editor.
CREATE TABLE IF NOT EXISTS public.app_config (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- La HEROHOME_API_KEY se EXTRAE AUTOMÁTICAMENTE del cron existente
-- (quedó grabada en cron.job al arreglar los crons el 5 de julio):
-- así setup-crons.sql deja de necesitar placeholder para siempre.
INSERT INTO public.app_config (key, value)
SELECT 'herohome_api_key',
       (regexp_match(command, '''x-api-key'',\s*''([^'']+)'''))[1]
FROM cron.job
WHERE jobname = 'generate-daily-slots'
  AND (regexp_match(command, '''x-api-key'',\s*''([^'']+)'''))[1] IS NOT NULL
ON CONFLICT (key) DO NOTHING;

-- URLs de los checks de Healthchecks.io (dead-man's-switch). Vacías de
-- inicio = sin ping (fail-open). Rellenar desde el Table Editor con la
-- "Ping URL" de cada check (https://hc-ping.com/…) cuando se creen.
INSERT INTO public.app_config (key, value) VALUES
  ('healthcheck_generate_slots',     ''),
  ('healthcheck_cleanup_old_slots',  ''),
  ('healthcheck_complete_visits',    ''),
  ('healthcheck_visit_reminders',    ''),
  ('healthcheck_post_visit_followup','')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- VERIFICACIÓN — la fila herohome_api_key debe existir y mostrar
-- los 4 primeros caracteres de tu key + su longitud (si sale vacía,
-- la extracción falló: edítala a mano en el Table Editor).
-- ----------------------------------------------------------------
SELECT key,
       CASE WHEN key = 'herohome_api_key'
            THEN left(coalesce(value, ''), 4) || '… (' || length(coalesce(value, '')) || ' caracteres)'
            ELSE coalesce(nullif(value, ''), '(vacío)')
       END AS value_preview
FROM public.app_config
ORDER BY key;

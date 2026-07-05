-- ================================================================
-- 2026-07-05 — Sección "Mi Equipo" + robustez del webhook WhatsApp
-- ----------------------------------------------------------------
-- Aplicar manual: Supabase Dashboard → SQL Editor → Run completo.
-- El código desplegado es FAIL-OPEN: funciona antes de aplicar esto
-- (la dedupe y el rate-limit simplemente no actúan hasta que exista
-- la tabla, y la PWA usa los defaults si las columnas no existen).
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Agente humano asignable POR VIVIENDA (sección "Mi Equipo").
--    NULL = la PWA usa los defaults (Alejandro + calendario general).
--    Se editan desde el Table Editor (interim del dashboard, B8):
--      agent_name         → nombre mostrado ("Alejandro Yuste")
--      agent_photo_url    → URL pública de la foto (opcional; sin foto
--                           se muestra un avatar con la inicial)
--      agent_calendar_url → link de Google Calendar del agente
-- ----------------------------------------------------------------
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS agent_name text,
  ADD COLUMN IF NOT EXISTS agent_photo_url text,
  ADD COLUMN IF NOT EXISTS agent_calendar_url text;

-- ----------------------------------------------------------------
-- 2. Dedupe + rate-limit del webhook de WhatsApp (whatsapp-agent).
--    Meta REINTENTA el webhook si el 200 tarda: cada mensaje entrante
--    se registra por su wamid; si ya existe, es un reintento y se
--    descarta. La misma tabla sirve para limitar mensajes/hora por
--    teléfono (protección de coste de la API de Anthropic).
--    Se purga a 7 días desde el cron cleanup-old-slots (Op 4).
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wa_processed_messages (
  wamid       text PRIMARY KEY,
  wa_phone    text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_processed_messages_phone_time_idx
  ON public.wa_processed_messages (wa_phone, received_at DESC);

-- RLS: DENY total a anon/authenticated (solo service_role), mismo patrón
-- que consents/whatsapp_conversations. Sin políticas = nadie accede salvo
-- service_role. (rls_auto_enable ya lo activaría; esto lo hace explícito.)
ALTER TABLE public.wa_processed_messages ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ----------------------------------------------------------------
-- DESPUÉS DE APLICAR ESTO: re-ejecutar el bloque "CRON 2 —
-- cleanup-old-slots" de setup-crons.sql (añade la Op 4: purga de
-- wa_processed_messages > 7 días).
-- ----------------------------------------------------------------

-- Verificación tras aplicar:
-- select column_name from information_schema.columns
--   where table_name = 'properties' and column_name like 'agent%';
-- select relrowsecurity from pg_class where relname = 'wa_processed_messages';

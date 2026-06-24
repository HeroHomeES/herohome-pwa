-- ================================================================
-- Herohome — B9 Gestión de Ofertas + post-visita
-- Migración de esquema (aplicar manual en Supabase SQL Editor)
-- ----------------------------------------------------------------
-- Pegar en: Supabase Dashboard → SQL Editor → New query → Run
-- Idempotente (IF NOT EXISTS / DROP NOT NULL): seguro re-ejecutar.
-- Diseño: docs/B9-OFERTAS.md (sección 3).
-- ================================================================


-- ----------------------------------------------------------------
-- offers — DNI y email del comprador (se capturan en create_offer)
-- ----------------------------------------------------------------
ALTER TABLE offers ADD COLUMN IF NOT EXISTS buyer_dni   text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS buyer_email text;


-- ----------------------------------------------------------------
-- offers.salesforce_quote_id — legacy (Salesforce solo hasta la
-- conversión, v3.1). Hoy es NOT NULL sin default, por eso el front
-- metía 'PWA_<uuid>'. Lo soltamos para dejar de escribir en él.
-- ----------------------------------------------------------------
ALTER TABLE offers ALTER COLUMN salesforce_quote_id DROP NOT NULL;


-- ----------------------------------------------------------------
-- visit_slots — disparador post-visita (idempotencia) + feedback
--   post_visit_sent_at  : marca de que ya se envió el follow-up
--   post_visit_outcome  : 'interested' | 'not_interested' | NULL
--   post_visit_feedback : motivo literal del visitante (raw)
-- ----------------------------------------------------------------
ALTER TABLE visit_slots ADD COLUMN IF NOT EXISTS post_visit_sent_at  timestamptz;
ALTER TABLE visit_slots ADD COLUMN IF NOT EXISTS post_visit_outcome  text;
ALTER TABLE visit_slots ADD COLUMN IF NOT EXISTS post_visit_feedback text;

-- Índice parcial para el cron post-visit-followup (Confirmed sin enviar)
CREATE INDEX IF NOT EXISTS idx_visit_slots_postvisit
  ON visit_slots (end_time)
  WHERE status = 'Confirmed' AND post_visit_sent_at IS NULL;


-- ================================================================
-- VERIFICACIÓN — ejecutar al final para confirmar el resultado
-- ================================================================
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
        (table_name = 'offers'      AND column_name IN ('buyer_dni','buyer_email','salesforce_quote_id'))
     OR (table_name = 'visit_slots' AND column_name IN ('post_visit_sent_at','post_visit_outcome','post_visit_feedback'))
      )
ORDER BY table_name, column_name;

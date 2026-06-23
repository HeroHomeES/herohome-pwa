-- ================================================================
-- Herohome — Migración: Gate de honorarios del comprador (B13 → integrado en B5)
-- ----------------------------------------------------------------
-- Pegar en: Supabase Dashboard → SQL Editor → New query → Run
-- Idempotente (IF NOT EXISTS). ⚠️ El proyecto es PRODUCCIÓN (no hay staging).
-- ================================================================


-- ----------------------------------------------------------------
-- 1) consents — trazabilidad del consentimiento de honorarios
--    Vincula el consentimiento a la propiedad y al slot, guarda el
--    texto EXACTO mostrado y el wamid del mensaje de aceptación del PC.
-- ----------------------------------------------------------------
ALTER TABLE consents
  ADD COLUMN IF NOT EXISTS property_id   uuid REFERENCES properties(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visit_slot_id uuid REFERENCES visit_slots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consent_text  text,
  ADD COLUMN IF NOT EXISTS wa_message_id text;


-- ----------------------------------------------------------------
-- 2) whatsapp_conversations — estado del gate entre turnos
--    (necesario para la máquina de estados awaiting_fee_consent:
--    el slot_id NO se persiste en el historial de texto).
--    agent_state guarda: {
--      state: 'awaiting_fee_consent',
--      pending_property_id, pending_slot_id,
--      visitor_name, visitor_last_name, visitor_email,
--      fee_percent, retries, gate_sent_at
--    }
-- ----------------------------------------------------------------
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS agent_state jsonb;

-- Índice parcial: el cron de limpieza (cleanup-old-slots) busca por este estado.
CREATE INDEX IF NOT EXISTS idx_wa_conversations_fee_gate
  ON whatsapp_conversations ((agent_state->>'state'))
  WHERE agent_state->>'state' = 'awaiting_fee_consent';


-- ----------------------------------------------------------------
-- 3) properties — % de comisión del comprador por vivienda
--    1 = 1%, 0.5 = 0,5%, 0 = sin gate (se reserva directo). Invariable por
--    vivienda: se fija ANTES de comercializar y se edita a mano en la tabla.
--    Por defecto 1 → todas las viviendas existentes quedan al 1% (sin cambios).
-- ----------------------------------------------------------------
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS buyer_fee_percent numeric NOT NULL DEFAULT 1
    CHECK (buyer_fee_percent >= 0 AND buyer_fee_percent <= 100);


-- ----------------------------------------------------------------
-- Verificación
-- ----------------------------------------------------------------
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
       (table_name = 'consents' AND column_name IN ('property_id','visit_slot_id','consent_text','wa_message_id'))
    OR (table_name = 'whatsapp_conversations' AND column_name = 'agent_state')
    OR (table_name = 'properties' AND column_name = 'buyer_fee_percent')
  )
ORDER BY table_name, column_name;

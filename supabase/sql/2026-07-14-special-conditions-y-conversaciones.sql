-- =====================================================================
-- 14 julio 2026 — Dos cambios (aplicar manualmente en el SQL Editor):
--
-- 1. properties.special_conditions: condiciones especiales de la
--    vivienda/venta (VPO, fechas de venta, etc.). Si está rellena,
--    el whatsapp-agent informa al comprador ANTES de mostrar horarios
--    y le pregunta si sigue interesado. Vacía/NULL = sin cambios.
--    Se edita a mano en el Table Editor.
--
-- 2. Política RLS de SOLO LECTURA para admins sobre
--    whatsapp_conversations, para la nueva sección "Conversaciones"
--    del dashboard de operaciones (admin.herohome.es). La tabla sigue
--    en DENY total para cualquier usuario que no esté en admin_users.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Condiciones especiales de la vivienda
-- ---------------------------------------------------------------------
alter table public.properties
  add column if not exists special_conditions text;

comment on column public.properties.special_conditions is
  'Condiciones especiales de la vivienda o de la venta (p.ej. VPO, fecha mínima de venta). Si está rellena, Hero (whatsapp-agent) informa al comprador antes de ofrecer horarios de visita y le pregunta si sigue interesado. NULL/vacía = comportamiento normal.';

-- ---------------------------------------------------------------------
-- 2. Lectura de conversaciones WhatsApp para el dashboard admin
--    (reutiliza is_admin() de 2026-07-07-admin-dashboard.sql)
-- ---------------------------------------------------------------------
drop policy if exists wa_conversations_select_admin on public.whatsapp_conversations;
create policy wa_conversations_select_admin
  on public.whatsapp_conversations for select
  to authenticated
  using (public.is_admin());

-- Verificación:
--   select column_name from information_schema.columns
--     where table_name = 'properties' and column_name = 'special_conditions';
--   select policyname from pg_policies
--     where tablename = 'whatsapp_conversations';

-- 2026-07-02 — Endurecimiento de RLS (revisión de seguridad B12)
--
-- Cambios (ninguno cambia el comportamiento efectivo; son hardening):
--   1. Acotar las políticas de acceso del rol `public` a `authenticated`.
--      Con `auth.uid()` un anónimo ya obtenía 0 filas; esto lo hace explícito
--      (anon deja de estar en el TO de la política).
--   2. Revocar EXECUTE de `rls_auto_enable()` a anon/authenticated/PUBLIC.
--      Es una función de event trigger (auto-activa RLS en tablas nuevas del
--      schema public); no debe ser ejecutable como RPC. Silencia el aviso del
--      Security Advisor sin afectar al trigger.
--
-- NO se toca `check_user_exists_by_email` (debe seguir siendo ejecutable por anon
-- para el login "no eres cliente"; enumeración de emails aceptada como trade-off).
-- NO se tocan las políticas DENY de `consents`/`whatsapp_conversations` (cubren
-- anon+authenticated a propósito) ni las INSERT de service_role.
--
-- Aplicar manual (MCP read-only). Idempotente en la práctica (ALTER POLICY / REVOKE).

BEGIN;

-- 1. public -> authenticated en las políticas de acceso del propietario
ALTER POLICY availability_select_own    ON public.availability_config TO authenticated;

ALTER POLICY notifications_select_own   ON public.notifications       TO authenticated;
ALTER POLICY notifications_update_own   ON public.notifications       TO authenticated;

ALTER POLICY offers_select_own          ON public.offers             TO authenticated;
ALTER POLICY offers_update_own_property ON public.offers             TO authenticated;

ALTER POLICY properties_select_own      ON public.properties         TO authenticated;
ALTER POLICY properties_update_own      ON public.properties         TO authenticated;

ALTER POLICY pwa_chat_insert_own        ON public.pwa_chat_sessions  TO authenticated;
ALTER POLICY pwa_chat_select_own        ON public.pwa_chat_sessions  TO authenticated;
ALTER POLICY pwa_chat_update_own        ON public.pwa_chat_sessions  TO authenticated;

ALTER POLICY users_select_own           ON public.users              TO authenticated;
ALTER POLICY users_update_own           ON public.users              TO authenticated;

ALTER POLICY slots_select_own           ON public.visit_slots        TO authenticated;
ALTER POLICY slots_update_own           ON public.visit_slots        TO authenticated;

-- 2. rls_auto_enable no debe ser ejecutable como RPC
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificación tras aplicar:
-- select tablename, policyname, roles from pg_policies
--   where schemaname='public' order by tablename, policyname;
-- (todas las de acceso deben mostrar {authenticated}; las DENY siguen {anon,authenticated})

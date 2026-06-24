-- ================================================================
-- Herohome — B9 Ofertas — Privacidad de columnas + centralización
-- ----------------------------------------------------------------
-- ⚠️ APLICAR DESPUÉS de desplegar el código de la pieza 2:
--    - el front ya selecciona columnas explícitas (sin DNI/email) y
--    - el front ya NO escribe en `offers` (llama a manage-offer).
--    Si se aplica antes, el front actual (select('*') / writes directos)
--    daría "permission denied".
-- ----------------------------------------------------------------
-- Pegar en: Supabase Dashboard → SQL Editor → New query → Run
-- Diseño: docs/B9-OFERTAS.md (sección 8) + decisión de sesión.
-- ================================================================


-- ----------------------------------------------------------------
-- 1. Lectura a nivel de columna (rol authenticated = propietario/CV):
--    ocultar DNI y email del comprador. El equipo Herohome los consulta
--    aparte vía Edge Functions con service_role (ignoran estos GRANT).
-- ----------------------------------------------------------------
REVOKE SELECT ON offers FROM authenticated;
GRANT SELECT (
  id, property_id, parent_offer_id, initiated_by,
  buyer_name, buyer_phone, amount, status,
  salesforce_quote_id, created_at, updated_at
) ON offers TO authenticated;


-- ----------------------------------------------------------------
-- 2. Escritura: el CV ya no modifica `offers` directamente. Toda alta o
--    cambio de estado pasa por las Edge Functions manage-offer /
--    create-offer (service_role). Defensa en profundidad.
-- ----------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON offers FROM authenticated;


-- ================================================================
-- VERIFICACIÓN — privilegios de columna de 'authenticated' sobre offers.
-- NO deben aparecer buyer_dni ni buyer_email (ni privilegios de escritura).
-- ================================================================
SELECT column_name, privilege_type
FROM information_schema.column_privileges
WHERE grantee = 'authenticated' AND table_name = 'offers'
ORDER BY column_name, privilege_type;

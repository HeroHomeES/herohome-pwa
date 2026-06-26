-- 2026-06-26 — Honorarios del propietario + importes calculados en properties
--
-- Contexto: ya existe properties.buyer_fee_percent (numeric, default 1, convención 1 = 1%).
-- Añadimos el % del propietario y los dos importes en € (calculados, no editables).
--
-- Convención de %: 1 = 1% (igual que buyer_fee_percent). Los € se calculan como
-- percent * sales_price / 100 y se redondean a 2 decimales.
--
-- owner_fee y buyer_fee son GENERATED ALWAYS ... STORED: Postgres los recalcula solos
-- cada vez que cambia sales_price o el % correspondiente. NO se escriben desde la app
-- ni desde la integración (un INSERT/UPDATE con valor explícito sobre ellas dará error).
--
-- Aplicar manualmente (MCP en read-only). Idempotente.

BEGIN;

-- 1. % de honorarios del propietario (lo rellena Salesforce; default 1 = 1%, invariable por vivienda)
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS owner_fee_percent numeric NOT NULL DEFAULT 1;

-- 2. Importe en € de honorarios del propietario = owner_fee_percent * sales_price / 100
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS owner_fee numeric
  GENERATED ALWAYS AS (round(sales_price * owner_fee_percent / 100, 2)) STORED;

-- 3. Importe en € de honorarios del comprador = buyer_fee_percent * sales_price / 100
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS buyer_fee numeric
  GENERATED ALWAYS AS (round(sales_price * buyer_fee_percent / 100, 2)) STORED;

COMMIT;

-- Verificación rápida tras aplicar:
-- select street, sales_price, owner_fee_percent, owner_fee, buyer_fee_percent, buyer_fee
-- from public.properties limit 5;

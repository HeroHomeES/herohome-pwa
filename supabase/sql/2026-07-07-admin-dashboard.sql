-- =====================================================================
-- B8 (v1) — Dashboard de Operaciones (admin.herohome.es)
-- Acceso de solo lectura para el equipo Herohome vía RLS.
-- Aplicar manualmente en el SQL Editor de Supabase (producción).
--
-- Después de aplicar este archivo, hay 2 pasos manuales (ver README
-- en admin/): crear el usuario admin en Authentication y ejecutar el
-- INSERT del PASO 2 (al final de este archivo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabla de administradores. Sin políticas => DENY total para
--    anon/authenticated (solo service_role y el SQL Editor pueden verla).
-- ---------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- ---------------------------------------------------------------------
-- 2. is_admin(): security definer para que las políticas puedan
--    consultar admin_users sin abrir la tabla (y sin recursión RLS).
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

-- Solo usuarios logueados pueden ejecutarla (anon siempre daría false,
-- pero no hace falta ni exponerla).
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Políticas SELECT para admins (solo lectura; el dashboard NO
--    escribe — cualquier escritura futura irá vía Edge Function,
--    según convención del proyecto).
--    Nota: en offers, el ACL por columna sigue mandando — buyer_dni y
--    buyer_email siguen ocultos al rol authenticated (también al admin).
-- ---------------------------------------------------------------------
drop policy if exists users_select_admin on public.users;
create policy users_select_admin
  on public.users for select
  to authenticated
  using (public.is_admin());

drop policy if exists properties_select_admin on public.properties;
create policy properties_select_admin
  on public.properties for select
  to authenticated
  using (public.is_admin());

drop policy if exists slots_select_admin on public.visit_slots;
create policy slots_select_admin
  on public.visit_slots for select
  to authenticated
  using (public.is_admin());

drop policy if exists offers_select_admin on public.offers;
create policy offers_select_admin
  on public.offers for select
  to authenticated
  using (public.is_admin());

-- =====================================================================
-- PASO 2 (ejecutar DESPUÉS de crear el usuario admin en
-- Authentication → Users → Add user, con email + contraseña y
-- "Auto Confirm User" activado):
--
--   insert into public.admin_users (user_id, email)
--   select id, email from auth.users where email = 'hola@herohome.es'
--   on conflict (user_id) do nothing;
--
-- Verificación:
--   select * from public.admin_users;
-- =====================================================================

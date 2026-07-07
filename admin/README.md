# Dashboard de Operaciones (B8 v1) — admin.herohome.es

Página estática autocontenida (`index.html`) de **solo lectura**: visibilidad de visitas y ofertas de todas las viviendas. Lee Supabase directamente con la anon key + sesión del usuario admin; el acceso a todos los datos lo dan las políticas RLS de admin (nunca la Service Role Key).

## Puesta en marcha (pasos manuales, una sola vez)

1. **SQL:** ejecutar `supabase/sql/2026-07-07-admin-dashboard.sql` en el SQL Editor
   (crea `admin_users`, `is_admin()` y las 4 políticas SELECT de admin).
2. **Usuario admin:** Dashboard → Authentication → Users → *Add user* →
   email `hola@herohome.es` + contraseña, con **Auto Confirm User** activado.
   Después, ejecutar el INSERT del "PASO 2" (final del archivo SQL).
3. **Vercel:** *Add New Project* → mismo repo `herohome-pwa` →
   **Root Directory: `admin`** → Framework: *Other* (sin build). Deploy.
4. **Dominio:** en el proyecto Vercel → Domains → `admin.herohome.es`
   (crear el CNAME que indique Vercel en el DNS de herohome.es).

A partir de ahí, cada push a `main` que toque `admin/` redespliega solo.

## Comportamiento

- **Login:** email + contraseña (Supabase Auth). Tras el login se valida
  `is_admin()`; una cuenta de CV no puede entrar aunque tenga sesión.
- **Para hoy:** visitas de hoy (cualquier estado), visitas `Pending to confirm`
  y ofertas `Presented` (indicando a quién le toca responder).
- **Por vivienda:** dirección, precio, propietario (nombre, teléfono, email),
  honorarios, visitas con su estado y feedback post-visita, y ofertas con la
  cadena de negociación (contraofertas del propietario incluidas).
- **Refresco:** automático cada 30 min / 1 h / 3 h / 6 h (selector en la
  cabecera, persistido en localStorage) + botón "Actualizar".
- **RGPD:** `buyer_dni` y `buyer_email` NO se piden (el ACL por columna de
  `offers` los oculta al rol `authenticated`, admin incluido).
- Zonas horarias en Europe/Madrid. Estados de BD en PascalCase (CLAUDE.md).

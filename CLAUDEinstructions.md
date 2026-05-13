# Herohome PWA

## WHY
PWA móvil para propietarios de vivienda (CV - Cliente Vendedor) que venden su inmueble con Herohome.
Les permite gestionar su vivienda, calendario de visitas, ofertas recibidas y chatear con un agente IA.
El backend es Supabase (ya desplegado). El CRM es Salesforce (ya existente). Este repo es SOLO el frontend PWA.

## WHAT
- React 18 + TypeScript + Vite + Tailwind CSS
- @supabase/supabase-js para autenticación (Magic Link) y datos
- React Router v6 para navegación
- vite-plugin-pwa para Service Worker y manifest.json
- Desplegado en Vercel desde este repo

## HOW

### Commands
- `npm run dev` — servidor de desarrollo (puerto 5173)
- `npm run build` — build de producción
- `npm run preview` — previsualizar build
- `npm run lint` — ESLint

### Architecture
```
src/
├── components/       # Componentes reutilizables (Button, Card, Modal, Toast)
├── pages/            # Páginas principales (Login, Home, Property, Calendar, Offers)
├── layouts/          # MainLayout con sidebar y header
├── hooks/            # Custom hooks (useAuth, useProperty, useVisits, useOffers)
├── lib/              # supabaseClient.ts, tipos, utilidades
├── context/          # AuthContext
└── main.tsx          # Entry point con router
```

### Code style
- TypeScript strict, no `any`
- Named exports, no default exports (excepto páginas para lazy loading)
- Tailwind utility classes, no CSS custom files
- Hooks para lógica de datos, componentes para UI
- Nombres de archivo: PascalCase para componentes, camelCase para hooks/utils

### Supabase
- URL: https://zqkvcphtqmibttgnivku.supabase.co
- La anon key está en .env como VITE_SUPABASE_ANON_KEY
- Auth: Magic Link (email). Sesiones de 7 días.
- RLS está activado: cada usuario solo ve sus propios datos (filtro por auth.uid())
- NUNCA uses la Service Role Key en el cliente. Solo anon key.

- ## Arquitectura v3.0

- La arquitectura vigente es la v3.0. Lee ARCHITECTURE_V3_DECISIONS.md antes de proponer funcionalidades o crear Edge Functions.
- No crear Edge Functions de sincronización con Salesforce (update-property-to-sf, update-offer-to-sf, confirm-visit-to-sf, sync-offer-from-sf). Corresponden a v2.0 y están eliminadas.
- Supabase es la fuente de verdad operativa para visitas, ofertas y propiedades. Salesforce solo se usa para onboarding (Lead → Account → Contact) y contratos.
- Notificaciones al PC: siempre vía webhook a Make → Gmail. Nunca vía Salesforce Flows.
- Email de bienvenida al CV: vía Edge Function + Resend (no Make).

### Reglas importantes
- NUNCA commitees .env ni secrets
- Las Edge Functions de Supabase NO están en este repo — están desplegadas aparte
- Toda la lógica de negocio compleja (sincronizar con Salesforce, enviar emails, IA) la hacen las Edge Functions. La PWA solo hace fetch a Supabase directamente (tablas) o a Edge Functions (acciones).
- El idioma de la UI es ESPAÑOL
- La app es mobile-first (diseña primero para 375px, luego adapta a desktop)
- Consulta docs/SPEC.md para la especificación técnica completa de cada fase

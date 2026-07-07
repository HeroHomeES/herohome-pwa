# DESIGN.md — Herohome v3.0

Drop this file into your project root. Any AI coding agent (Claude Code, Cursor, Copilot, Gemini CLI) will use it to generate UI that matches Herohome's visual identity exactly.

> v3.0 actualiza el logo al símbolo **Pulse** y añade Space Mono como fuente de metadatos. Fuente canónica: brandbook standalone en `docs/brandbook/herohome-brandbook-standalone.html` (proyecto de Claude Design "Logo Herohome").

## Brand overview

Herohome is Spain's first fully digital real-estate agent. The brand sits at the intersection of PropTech and AI — professional, trustworthy, and technically sophisticated without being cold. Visual references: **Stripe, Linear, Vercel, Anthropic**.

Tagline: *Vende tu casa. Sin intermediarios innecesarios.*

## Logo

### Concept — Pulse

Dos barras verticales redondeadas con gradiente violeta ascendente. La barra izquierda ocupa la altura completa; la derecha es más corta y está desplazada hacia abajo. La asimetría es intencional: evoca movimiento, proceso en curso e inteligencia artificial viva.

- **Barra izquierda** — altura completa (y 6→58). Gradiente `#A5A6FF → #3C3ECC`.
- **Barra derecha** — más corta, desplazada abajo (y 18→58). Gradiente `#5B5CFF → #282999`.
- **Gap central** — 8 unidades en el viewBox de 64; nunca reducirlo.

### SVG source — symbol only (light & dark backgrounds)

```svg
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hh-l" x1="0" y1="6" x2="0" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#A5A6FF"/>
      <stop offset="100%" stop-color="#3C3ECC"/>
    </linearGradient>
    <linearGradient id="hh-r" x1="0" y1="18" x2="0" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5B5CFF"/>
      <stop offset="100%" stop-color="#282999"/>
    </linearGradient>
  </defs>
  <rect x="10" y="6" width="12" height="52" rx="5" fill="url(#hh-l)"/>
  <rect x="30" y="18" width="12" height="40" rx="5" fill="url(#hh-r)"/>
</svg>
```

### SVG source — on violet background (app icon, avatar)

Sobre fondo violeta `#5B5CFF` las barras van en blanco semitransparente, sin gradiente:

```svg
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="14" fill="#5B5CFF"/>
  <rect x="10" y="6" width="12" height="52" rx="5" fill="rgba(255,255,255,0.9)"/>
  <rect x="30" y="18" width="12" height="40" rx="5" fill="rgba(255,255,255,0.65)"/>
</svg>
```

### Wordmark

- Font: **Inter 600**, `letter-spacing: -0.03em`
- Text: **Herohome** (capital H only, no camel case, no all-caps)

### Lockup rules

| Context | Form |
|---|---|
| Navbar / header | Symbol (28–40px) + wordmark, horizontal, gap 10–13px |
| App icon iOS/Android | Symbol (white bars variant) on violet `#5B5CFF` background, `border-radius: 22%` |
| Favicon 16×16 | Symbol only (gradient variant), no background |
| Email footer | Symbol (24px) + wordmark, horizontal |
| Loading / splash | Symbol only, large, centred, dark background |
| Dark backgrounds | Arms use white gradients (see app icon SVG above) |
| Light backgrounds | Arms use violet gradients (see symbol SVG above) |

### What NOT to do

- Do not rotate or mirror the symbol — the asymmetry (right bar lower) is intentional
- Do not equalise the bar heights or "fix" the offset
- Do not recolour the bars outside the defined palette
- Do not add a drop shadow or outer glow
- Do not stretch or distort proportions, and do not reduce the central gap
- Do not place the wordmark above or below the symbol — only horizontal lockup
- Do not use HeroHome, HEROHOME, or hero home — always **Herohome**

## Color palette

### Primary colors

| Token | Hex | Usage |
|---|---|---|
| `--color-ink` | `#0A0E17` | Primary dark background, hero sections, nav dark |
| `--color-ink-2` | `#1C2333` | Secondary dark surfaces, cards on dark |
| `--color-violet` | `#5B5CFF` | Primary accent — CTAs, links, focus rings, logo centre |
| `--color-violet-dark` | `#3C3ECC` | Hover state for violet, pressed buttons |
| `--color-violet-light` | `#EEEEFF` | Violet tint backgrounds, badges, highlights |
| `--color-teal` | `#0EA5A0` | Success, confirmed states, positive indicators |
| `--color-teal-light` | `#E0F7F6` | Teal tint backgrounds |
| `--color-surface` | `#F8FAFC` | Page background (cool white, not warm) |
| `--color-white` | `#FFFFFF` | Card backgrounds, modal surfaces |
| `--color-slate` | `#64748B` | Secondary text, labels, metadata |
| `--color-slate-light` | `#94A3B8` | Tertiary text, placeholders, hints |
| `--color-border` | `#E2E8F0` | Default borders, dividers |
| `--color-border-subtle` | `#F1F5F9` | Subtle section dividers |

### Violet scale (9 stops)

```
50:  #EEEEFF   ← badge backgrounds, tint fills
100: #CACBFF
200: #A5A6FF   ← node 2 (right arm)
300: #8081FF
400: #5B5CFF   ★ PRIMARY — centre node, CTAs
500: #4344CC
600: #3C3ECC   ← hover states
700: #282999
800: #181966   ← darkest fills on light bg
```

Logo gradients specifically (símbolo Pulse):

- Left bar: `#A5A6FF → #3C3ECC` (vertical, top to bottom)
- Right bar: `#5B5CFF → #282999` (vertical, top to bottom)
- On violet background: left bar `rgba(255,255,255,0.9)`, right bar `rgba(255,255,255,0.65)` (no gradient)
- `--color-violet-deep: #282999` — logo gradient stop, darkest violet in the system

### Semantic colors

| State | Background | Text | Border |
|---|---|---|---|
| Success | `#E0F7F6` | `#0EA5A0` | `#99E6D8` |
| Warning | `#FFF7ED` | `#C2620A` | `#FED7AA` |
| Error | `#FFF0F0` | `#E05353` | `#FBBFBF` |
| Info | `#EEEEFF` | `#3C3ECC` | `#CACBFF` |
| Neutral | `#F8FAFC` | `#64748B` | `#E2E8F0` |

### Dark mode

All UI must work in both light and dark mode. Dark mode surface stack:

- Page background: `#0A0E17` (`--color-ink`)
- Card surface: `#1C2333` (`--color-ink-2`)
- Elevated card: `#232E42`
- Border: `rgba(255,255,255,0.08)`
- Border hover: `rgba(255,255,255,0.14)`
- Text primary: `#F8FAFC`
- Text secondary: `rgba(255,255,255,0.55)`
- Text tertiary: `rgba(255,255,255,0.30)`

## Typography

Primary font family: **Inter**. No serif. Variation comes from weight and size.

```css
font-family: 'Inter', system-ui, -apple-system, sans-serif;
```

Accent font (v3): **Space Mono**, only for tiny metadata — spec annotations, hex values, version labels, do/don't tags. Never for headings, body text, or UI controls.

```css
font-family: 'Space Mono', monospace;
/* typical use: font-size 9-11px; letter-spacing 0.1-0.16em; text-transform uppercase */
```

### Type scale

| Role | Size | Weight | Letter-spacing | Line-height | Usage |
|---|---|---|---|---|---|
| Display | 52–64px | 700 | -0.04em | 1.0 | Landing hero headlines |
| H1 | 34–40px | 600 | -0.03em | 1.1 | Section titles, page headers |
| H2 | 22–26px | 600 | -0.025em | 1.2 | Card titles, modal headers |
| H3 | 18–20px | 600 | -0.02em | 1.3 | Subsection titles |
| Body large | 16px | 400 | -0.01em | 1.75 | Primary paragraph text |
| Body | 14–15px | 400 | 0 | 1.7 | Secondary paragraph, descriptions |
| UI medium | 13px | 500 | -0.01em | 1.5 | Buttons, nav items, card actions |
| UI small | 12px | 500 | 0 | 1.5 | Secondary labels, metadata |
| Label / eyebrow | 11px | 700 | +0.12em | 1.4 | Section labels (always uppercase) |
| Mono | 13px | 400 | 0 | 1.6 | Code, hex values, IDs |

### Eyebrow labels (section labels)

Always: `font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #5B5CFF`

Example: PRECIO DE VENTA, MIS OFERTAS, PRÓXIMAS VISITAS

### Rules

- Sentence case for all body text and headings (not Title Case)
- ALL CAPS only for eyebrow labels and status badges
- Never use font-weight 300 in UI contexts — minimum 400
- Heading colour is always `--color-ink` on light, `#F8FAFC` on dark
- Body text colour is `--color-slate` (`#64748B`) for secondary content
- Never mix serif with Inter anywhere in the product; Space Mono only in metadata sizes (9–11px)

## Spacing

Base unit: **4px**. All spacing values are multiples of 4.

| Value | Token | Usage |
|---|---|---|
| 4px | xs | icon internal padding, tight gaps |
| 8px | sm | between inline elements, icon + label |
| 12px | — | between list items |
| 16px | base | standard component padding, form field padding |
| 20px | — | between cards in a tight grid |
| 24px | md | section internal padding, card padding |
| 32px | — | between major components |
| 40px | — | section padding (mobile) |
| 48px | lg | section padding (desktop) |
| 64px | xl | between page sections |

## Border radius

| Value | Usage |
|---|---|
| 4px | subtle rounding, table cells |
| 7px | buttons, inputs, small cards |
| 10px | standard cards, modals |
| 12px | large cards, panels |
| 14px | feature cards |
| 50% | avatars, node circles, pills |

## Borders

```css
/* Default */
border: 1px solid #E2E8F0;

/* Subtle (section dividers) */
border: 1px solid #F1F5F9;

/* Medium (hover, focus context) */
border: 1px solid #CBD5E1;

/* Accent (featured items only) */
border: 2px solid #5B5CFF;

/* Dark mode default */
border: 1px solid rgba(255, 255, 255, 0.08);

/* Dark mode hover */
border: 1px solid rgba(255, 255, 255, 0.14);
```

**Never use box shadows for elevation** — use border colour changes instead (Stripe/Linear convention).

## Components

### Buttons

```css
/* Primary */
background: #5B5CFF;
color: #FFFFFF;
padding: 10px 20px;
border-radius: 7px;
font-size: 13px;
font-weight: 500;
letter-spacing: -0.01em;
border: none;

/* Hover */
background: #3C3ECC;

/* Secondary */
background: transparent;
color: #0A0E17;
border: 1px solid #E2E8F0;
/* Hover: background #F8FAFC */

/* Dark (ink) */
background: #0A0E17;
color: #F8FAFC;

/* Ghost on dark bg */
background: rgba(255,255,255,0.08);
color: #F8FAFC;
border: 1px solid rgba(255,255,255,0.14);
```

Button sizes: sm → `8px 14px`, md → `10px 20px` (default), lg → `12px 28px`

### Badges / status pills

```css
/* Base */
padding: 3px 10px;
border-radius: 20px;
font-size: 11px;
font-weight: 600;
letter-spacing: 0.02em;

/* Violet (info, published) */
background: #EEEEFF; color: #3C3ECC;

/* Teal (confirmed, success) */
background: #E0F7F6; color: #0EA5A0;

/* Ink (live, active) */
background: #0A0E17; color: #F8FAFC;

/* Neutral (pending) */
background: #F8FAFC; color: #64748B; border: 1px solid #E2E8F0;

/* Error (cancelled) */
background: #FFF0F0; color: #E05353;
```

### Cards

```css
/* Standard card */
background: #FFFFFF;
border: 1px solid #E2E8F0;
border-radius: 12px;
padding: 22px;

/* Surface card (on --color-surface bg) */
background: #FFFFFF;
border: 1px solid #E2E8F0;
border-radius: 10px;
padding: 16px;

/* Dark card */
background: #1C2333;
border: 1px solid rgba(255,255,255,0.08);
border-radius: 12px;
padding: 22px;

/* Featured / highlighted card */
border: 2px solid #5B5CFF;
```

### Form inputs

```css
input, select, textarea {
  border: 1px solid #E2E8F0;
  border-radius: 7px;
  padding: 9px 13px;
  font-size: 13px;
  font-family: 'Inter', sans-serif;
  color: #0A0E17;
  background: #FFFFFF;
  width: 100%;
}

input:focus {
  border-color: #5B5CFF;
  outline: none;
  box-shadow: 0 0 0 3px rgba(91,92,255,0.12);
}

/* Label */
label {
  font-size: 11px;
  font-weight: 600;
  color: #94A3B8;
  letter-spacing: 0.02em;
  display: block;
  margin-bottom: 5px;
}
```

### Property card (vivienda)

A key recurring component in the PWA:

```
┌─────────────────────────────────┐
│ [image / placeholder]   [badge] │  ← 100–120px tall image area, dark bg
├─────────────────────────────────┤
│ 450.000 €                       │  ← 20px 700 ink
│ C/ Gran Vía 48, 3ºA · Madrid    │  ← 11px slate-light
│ 3 hab. · 85 m² · 2 baños        │  ← 11px 500 slate
└─────────────────────────────────┘
```

Price uses `font-size: 20px; font-weight: 700; letter-spacing: -0.03em`

### Navigation bar (PWA)

```
┌──────────────────────────────────────────────────┐
│ [symbol 22px] Herohome              [●] [●] [●]  │
└──────────────────────────────────────────────────┘
bg: #111827, height: 52px, padding: 0 16px
```

### Chat / conversational interface (Hero agent)

The app's home screen is a chat interface (like Claude or ChatGPT):

- bg: `--color-surface` or `--color-ink` (dark mode)
- User bubble: bg `#5B5CFF`, color white, `border-radius 16px 16px 4px 16px`
- Agent bubble: bg white (light) / `#1C2333` (dark), border 1px solid `--border`, `border-radius 16px 16px 16px 4px`
- Input bar: bottom of screen, bg white, border-top 1px solid `--border`, input field + send button (violet)

## Iconography

- Style: **stroke-only, 1.5px stroke**, rounded linecap and linejoin, no fill
- Size: 18–20px in UI, 16px in dense contexts
- Colour: inherits from context (`--color-slate` secondary, `--color-violet` active, white on dark)

Icon set recommendation: **Lucide** (matches the aesthetic perfectly — same stroke style as Linear, Vercel)

Key icons used in Herohome:

- `home` — vivienda / property
- `calendar` — visitas / calendar
- `tag` — ofertas / offers
- `message-circle` — Hero chat
- `check-circle` — confirmed / success
- `clock` — pending / pendiente
- `user` — propietario / contact
- `map-pin` — ubicación
- `euro` — precio / comisión
- `shield-check` — confianza / trust

## Layout

### Grid

```css
/* Page max-width */
max-width: 1200px;
margin: 0 auto;
padding: 0 24px;   /* mobile: 0 16px */

/* Card grids */
display: grid;
grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
gap: 16px;

/* Two-column layout */
grid-template-columns: 1fr 1fr;
gap: 20px;

/* Three-column layout */
grid-template-columns: repeat(3, 1fr);
gap: 16px;
```

### PWA structure (mobile-first)

```
┌─────────────────────────┐
│ Navbar (52px)           │
├─────────────────────────┤
│                         │
│ Main content area       │
│ (scrollable)            │
│                         │
├─────────────────────────┤
│ Bottom tab bar (60px)   │  ← Chat · Vivienda · Calendario · Ofertas
└─────────────────────────┘
```

Bottom tab bar:

```css
background: #FFFFFF (light) / #0A0E17 (dark);
border-top: 1px solid #E2E8F0 / rgba(255,255,255,0.08);
height: 60px;
display: flex;
justify-content: space-around;
align-items: center;
```

Active tab: icon + label in `#5B5CFF`, inactive in `#94A3B8`

## Motion & animation

Herohome uses **subtle, functional animation**. No decorative motion.

```css
/* Default transition */
transition: all 0.15s ease;

/* Button hover */
transition: background 0.1s ease, transform 0.1s ease;
transform: scale(0.98);   /* on :active */

/* Card hover */
transition: border-color 0.15s ease;
/* border-color shifts from --border to #CBD5E1 */

/* Page transitions (PWA) */
transition: opacity 0.2s ease, transform 0.2s ease;
/* Enter: opacity 0→1, translateY 8px→0 */

/* Skeleton loading */
animation: pulse 1.5s ease-in-out infinite;
/* opacity 1 → 0.5 → 1 */
```

No bounce, no spring physics, no parallax. Stripe/Linear convention: fast and invisible.

## Voice & tone

### Personality

| Attribute | Description |
|---|---|
| Direct | One sentence, one message. If something is free, say it first. If there's a fee, state it plainly. |
| Empathetic | Selling a home is a major life decision. Accompany without pressuring. Explain without condescending. |
| Innovative by action | Never say "AI-powered" — show the feature and explain the time saved. |
| Trustworthy by data | Concrete numbers, real timescales, explicit commitments. Trust is earned by facts, not adjectives. |

### Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| "Tu piso se publica en Idealista en menos de 48 h." | "Su inmueble ha sido exitosamente incorporado a nuestra plataforma." |
| "Primera venta gratis. Después, solo el 1%. Sin sorpresas." | "Optimizamos el proceso de desinversión patrimonial." |
| "Tienes una nueva oferta de 420.000 €. ¿Qué quieres hacer?" | "Se ha recibido una propuesta de adquisición por el activo gestionado." |
| "Hero está revisando tu vivienda." | "Nuestro sistema de IA está procesando su solicitud." |

### Naming conventions

- The AI agent is always called **Hero** (capital H, no article: "Hero te avisa", not "el Hero")
- The owner/seller is always **tú** (second person singular, informal)
- Fees: always **1%**, never "un uno por ciento" or "una pequeña comisión"
- The app: **Herohome** (never "la app", "la plataforma", "el sistema")

## Logo in code — React component

```jsx
// HerohomeLogo.jsx — símbolo Pulse
// Props: size (number, default 40), variant ("light" | "dark" | "icon-violet")

export function HerohomeLogo({ size = 40, variant = "light", showWordmark = true }) {
  const isLight = variant === "light";
  const isIconViolet = variant === "icon-violet";
  const uid = isIconViolet ? "hhv" : isLight ? "hhl" : "hhd";

  const Symbol = () => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {isIconViolet && <rect width="64" height="64" rx="14" fill="#5B5CFF" />}
      {!isIconViolet && (
        <defs>
          <linearGradient id={`${uid}-l`} x1="0" y1="6" x2="0" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#A5A6FF" />
            <stop offset="100%" stopColor="#3C3ECC" />
          </linearGradient>
          <linearGradient id={`${uid}-r`} x1="0" y1="18" x2="0" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5B5CFF" />
            <stop offset="100%" stopColor="#282999" />
          </linearGradient>
        </defs>
      )}
      <rect x="10" y="6" width="12" height="52" rx="5"
        fill={isIconViolet ? "rgba(255,255,255,0.9)" : `url(#${uid}-l)`} />
      <rect x="30" y="18" width="12" height="40" rx="5"
        fill={isIconViolet ? "rgba(255,255,255,0.65)" : `url(#${uid}-r)`} />
    </svg>
  );

  if (!showWordmark) return <Symbol />;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
      <Symbol />
      <span style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: size * 0.52,
        fontWeight: 600,
        letterSpacing: "-0.03em",
        color: isLight ? "#0A0E17" : "#F8FAFC",
        lineHeight: 1,
      }}>
        Herohome
      </span>
    </div>
  );
}
```

## CSS custom properties — full token sheet

Paste this into your root stylesheet:

```css
:root {
  /* Brand */
  --hh-ink: #0A0E17;
  --hh-ink-2: #1C2333;
  --hh-violet: #5B5CFF;
  --hh-violet-dark: #3C3ECC;
  --hh-violet-deep: #282999;
  --hh-violet-light: #EEEEFF;
  --hh-teal: #0EA5A0;
  --hh-teal-light: #E0F7F6;
  --hh-surface: #F8FAFC;
  --hh-white: #FFFFFF;
  --hh-slate: #64748B;
  --hh-slate-light: #94A3B8;
  --hh-border: #E2E8F0;
  --hh-border-subtle: #F1F5F9;

  /* Logo gradient stops (símbolo Pulse) */
  --hh-logo-left-from: #A5A6FF;
  --hh-logo-left-to: #3C3ECC;
  --hh-logo-right-from: #5B5CFF;
  --hh-logo-right-to: #282999;

  /* Typography */
  --hh-font: 'Inter', system-ui, -apple-system, sans-serif;
  --hh-mono: 'Space Mono', monospace;

  /* Radius */
  --hh-radius-sm: 4px;
  --hh-radius-md: 7px;
  --hh-radius-lg: 10px;
  --hh-radius-xl: 12px;
  --hh-radius-2xl: 14px;

  /* Spacing */
  --hh-space-1: 4px;
  --hh-space-2: 8px;
  --hh-space-3: 12px;
  --hh-space-4: 16px;
  --hh-space-5: 20px;
  --hh-space-6: 24px;
  --hh-space-8: 32px;
  --hh-space-10: 40px;
  --hh-space-12: 48px;
  --hh-space-16: 64px;

  /* Transitions */
  --hh-transition: all 0.15s ease;
}

/* Dark mode overrides */
@media (prefers-color-scheme: dark) {
  :root {
    --hh-surface: #0A0E17;
    --hh-white: #1C2333;
    --hh-border: rgba(255,255,255,0.08);
    --hh-border-subtle: rgba(255,255,255,0.04);
    --hh-slate: rgba(255,255,255,0.55);
    --hh-slate-light: rgba(255,255,255,0.30);
  }
}
```

## Tailwind config (if using Tailwind CSS)

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0A0E17', 2: '#1C2333' },
        violet: {
          DEFAULT: '#5B5CFF',
          dark: '#3C3ECC',
          light: '#EEEEFF',
          50: '#EEEEFF',
          100: '#CACBFF',
          200: '#A5A6FF',
          300: '#8081FF',
          400: '#5B5CFF',
          500: '#4344CC',
          600: '#3C3ECC',
          700: '#282999',
          800: '#181966',
        },
        teal: { DEFAULT: '#0EA5A0', light: '#E0F7F6' },
        slate: { DEFAULT: '#64748B', light: '#94A3B8' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        'sm': '4px',
        'md': '7px',
        'lg': '10px',
        'xl': '12px',
        '2xl': '14px',
      },
      letterSpacing: {
        'display': '-0.04em',
        'heading': '-0.03em',
        'title': '-0.025em',
        'label': '0.14em',
      },
    },
  },
}
```

## Do's and don'ts summary

| ✅ Do | ❌ Don't |
|---|---|
| Use Herohome (capital H only) | Use HeroHome, herohome, HEROHOME |
| Use Inter for all text | Mix in any serif or display font |
| Use `#5B5CFF` as the single accent | Add secondary accent colours |
| Use 1px borders for elevation | Use box-shadows for elevation |
| Use teal `#0EA5A0` for success/confirmed | Use generic green |
| Keep logo asymmetry intact (right bar lower) | Rotate, mirror, or "fix" the symbol |
| Use `letter-spacing: -0.03em` on headings | Use default letter-spacing on large type |
| Keep dark backgrounds to `#0A0E17` / `#1C2333` | Use pure black `#000000` |
| Use sentence case in all UI copy | Use Title Case in headings or buttons |
| Name the AI agent "Hero" | Call it "the AI", "the bot", "el agente" |

---

*Herohome DESIGN.md v3.0 — 2026*
*herohome.es · hola@herohome.es*

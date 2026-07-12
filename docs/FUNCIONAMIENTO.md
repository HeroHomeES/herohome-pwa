# Herohome — Funcionamiento del sistema

> **Qué es este documento.** Descripción exhaustiva del funcionamiento **actual** de la plataforma
> Herohome desde el punto de vista funcional, con el nivel técnico justo (qué sistema hace qué, por
> dónde fluyen los datos, qué mensajes se envían y cuándo). No entra en código, mapeos de campos ni
> detalles de implementación.
>
> **Para qué sirve.** (1) Punto de partida único para diseñar evolutivos. (2) Contexto de proyecto
> para generar skills o agentes (marketing, cualificación de leads, soporte…) que necesiten saber
> cómo funciona la plataforma de verdad.
>
> Fuentes: `CLAUDE.md`, `ARCHITECTURE_V3_DECISIONS.md`, `docs/AGENT.md`, `docs/B9-OFERTAS.md` y el
> código de las Edge Functions (los textos de mensajes están copiados literalmente de ahí).

---

## 1. Qué es Herohome

Herohome es la primera agencia inmobiliaria 100% digital de España. Los propietarios venden su
vivienda asistidos por un agente de IA llamado **Hero**. Modelo de comisión: **1% al vendedor + 1%
al comprador** (configurable por vivienda). Web corporativa: herohome.es. La app del propietario
vive en **app.herohome.es** (PWA instalable en el móvil).

**Naming:** siempre "Herohome" (nunca HeroHome ni HEROHOME). El agente IA se llama **Hero** (nunca
"el bot" ni "la IA").

---

## 2. Actores

| Actor | Quién es | Canal con Herohome |
|---|---|---|
| **CV** — Cliente Vendedor | Propietario con contrato firmado | **PWA** (app.herohome.es) + email |
| **PC** — Prospecto Comprador | Interesado en comprar una vivienda | **Solo WhatsApp** + email. Nunca accede a la PWA |
| **PV** — Prospecto Vendedor | Propietario sin contrato todavía | Web corporativa / comercial. No accede a la PWA |
| **Hero** | Agente de IA (Claude, API de Anthropic). Dos instancias: una atiende al PC por WhatsApp y otra al CV dentro de la PWA | WhatsApp / chat de la PWA |
| **Agente Herohome** | Persona del equipo para lo no automatizable (arras, firma, incidencias) | Teléfono, email `hola@herohome.es`, dashboard de operaciones |

---

## 3. Mapa de sistemas

| Sistema | Rol |
|---|---|
| **Supabase** | El **sistema operativo de la venta**: base de datos (PostgreSQL), autenticación, lógica de negocio (Edge Functions) y tareas programadas (crons). Es la fuente de verdad de viviendas (operativo), visitas, ofertas, conversaciones, notificaciones y consentimientos. **Es producción; no hay staging.** |
| **PWA** (React, hosting Vercel) | La app del propietario. No contiene lógica de negocio: consulta la BD y llama a Edge Functions. |
| **Salesforce** | Sistema de registro **legal y contractual**, y está **CONGELADO**: no se desarrolla nada nuevo en él. Su único rol operativo: gestionar Leads, y al convertir un cliente, el botón "Enviar acceso PWA" que da de alta al propietario en Supabase. También aloja contratos y firma (Docs/Sign Made Easy). |
| **Make.com** | Reducido a un único escenario activo: formulario web → Lead en Salesforce. Nada más pasa por Make. (El antiguo escenario de ingesta de Idealista se mantiene configurado pero **inactivo**, solo como fallback.) |
| **Google Apps Script** | Un script que corre **dentro del propio Gmail de Herohome** (`hola@herohome.es`) ingesta los leads de Idealista y los reenvía a Supabase cada minuto (ver §4.4). Sustituye al antiguo escenario 2 de Make. |
| **WhatsApp Cloud API** (Meta) | Canal con el comprador. Los mensajes entrantes llegan por webhook directamente a la Edge Function del agente; los salientes se envían por la API (plantillas aprobadas o texto libre). |
| **Resend** | **Único canal de email transaccional** (a CV, PC y equipo). Las plantillas HTML viven en el código. |
| **Anthropic API** | Los cerebros de Hero (modelo Sonnet para los dos agentes conversacionales) y la extracción de datos de los emails de Idealista (modelo Haiku, más barato). |
| **Dashboard de operaciones** | admin.herohome.es — vista de solo lectura para el equipo (ver §10). |
| **Healthchecks.io** | Servicio externo de "dead-man's-switch": detecta si un cron ha dejado de ejecutarse (ver §9). |

**Principio de flujo de datos:** los datos fluyen de Salesforce a Supabase **una sola vez** (en el
alta del propietario). No hay sincronización de vuelta ni integraciones bidireccionales. Todo lo
que ocurre después de esa alta (visitas, ofertas, conversaciones) vive **solo** en Supabase.
Salesforce vuelve a entrar en juego únicamente al final, de forma manual, para arras y firma.

**Despliegue:** un push a la rama `main` del repositorio despliega automáticamente la PWA y el
dashboard (Vercel) y las Edge Functions (GitHub Action).

---

## 4. El ciclo de venta, de principio a fin

### 4.1 Captación del vendedor y alta en la plataforma

1. Un propietario interesado llega por la web corporativa. El formulario web crea un **Lead en
   Salesforce** (vía Make, Escenario 1).
2. El equipo trabaja el lead de forma comercial y, si hay acuerdo, se firma el contrato
   (Salesforce + Docs/Sign Made Easy). El propietario pasa a ser **CV**.
3. En la ficha del cliente en Salesforce, el equipo pulsa el botón **"Enviar acceso PWA"**. Ese
   botón ejecuta una **clase Apex** (`HerohomeSupabaseCallout`) que hace una única llamada HTTP a
   la Edge Function **`create-user`** de Supabase con los datos del propietario y de la vivienda.
4. `create-user`:
   - Crea el usuario en Supabase Auth (rol vendedor) y su registro en la tabla de usuarios.
   - Crea (o actualiza, es idempotente) la vivienda en la tabla de propiedades con todos sus
     datos: dirección, características, precio, % de honorarios de vendedor y comprador, etc.
     Los honorarios en € los calcula la propia base de datos a partir del precio y el %.
   - Genera un **Magic Link** de acceso y envía el **email de bienvenida** (ver §7.1).
5. Si el alta va bien, Salesforce marca al contacto como "acceso enviado"; si falla, crea una
   tarea en Salesforce con el error para que el equipo lo revise.

A partir de aquí Salesforce ya no interviene en la operación diaria.

### 4.2 Acceso del propietario a la PWA

- El login es **solo por Magic Link** (enlace de un solo uso al email). No hay contraseñas.
  Las sesiones duran 7 días.
- El email del enlace lo envía Supabase Auth con plantilla de marca: asunto **"Tu link para
  acceder a Herohome"**, cuerpo "Pulsa aquí para acceder:" y botón "Ir a Herohome".
- Si alguien pide acceso con un email que no es cliente, la pantalla de login se lo indica
  (no se envía enlace).

### 4.3 Disponibilidad y generación de huecos de visita

- El CV define en la PWA su **plantilla semanal de disponibilidad** (qué días y franjas admite
  visitas). Al guardar, el sistema genera inmediatamente los huecos.
- La Edge Function **`generate-slots`** mantiene sincronizada una **ventana móvil de 14 días** de
  huecos de 1 hora por vivienda en venta, de forma idempotente: crea los que falten según la
  plantilla, borra los libres que ya no encajen y **nunca toca** los reservados, confirmados o
  bloqueados. Se ejecuta cada noche (cron de las 03:00 UTC) y también al guardar disponibilidad
  desde la PWA.
- Estados posibles de un hueco/visita: `Available` (libre), `Pending to confirm` (solicitada por
  un comprador, pendiente del propietario), `Confirmed`, `Canceled by owner`,
  `Canceled by visitor`, `Not available` (bloqueado/expirado) y `Completed` (visita realizada).

### 4.4 Captación del comprador (leads de Idealista)

1. El anuncio de la vivienda está en Idealista. Cuando un interesado contacta, Idealista envía un
   **email** al buzón de Gmail de Herohome (`hola@herohome.es`).
2. Un **Google Apps Script** que corre dentro del propio buzón revisa el correo **cada minuto**
   (disparador temporal) buscando los emails de lead de Idealista aún sin procesar. El filtro
   captura solo la dirección transaccional de contactos de Idealista (las newsletters y alertas
   salen de otras direcciones y se ignoran). Por cada email, el script envía el asunto, el cuerpo
   en texto plano y el remitente a la Edge Function **`process-idealista-lead`**. Solo si la
   función responde bien, etiqueta el email como procesado (`herohome-procesado`); si algo falla
   (red, servidor, configuración), lo deja sin etiquetar y el siguiente tick lo **reintenta
   solo**. El buzón actúa así de cola: **ningún lead se pierde** aunque el script caiga un rato, y
   un procesado doble es inocuo porque la función deduplica por teléfono + vivienda. El script
   incluye además un modo prueba configurable que acota la ingesta a una vivienda concreta (útil
   durante un onboarding). *(El antiguo escenario 2 de Make queda configurado pero inactivo, como
   fallback.)*
3. La función extrae **nombre, teléfono y referencia de la vivienda** del email usando un LLM con
   salida estructurada (nunca regex: Idealista cambia sus plantillas sin avisar). Después:
   - Localiza la vivienda en Supabase por la referencia.
   - Normaliza el teléfono a formato internacional y comprueba que no exista ya conversación con
     ese teléfono para esa vivienda (evita duplicados).
   - Envía al comprador la **plantilla de WhatsApp de bienvenida** (`bienvenida_pc`, con la
     dirección de la vivienda como parámetro) y **siembra la conversación** en la base de datos,
     dejando el teléfono vinculado a la vivienda.
4. Si cualquier paso falla (extracción, vivienda no encontrada, WhatsApp no entregado), se envía
   un **email de alerta al equipo** con asunto "⚠️ Fallo al procesar lead de Idealista", el motivo,
   los datos extraídos y el email original, para gestionarlo a mano. Un lead nunca se pierde en
   silencio.

### 4.5 Conversación por WhatsApp y reserva de visita

Cuando el comprador responde al WhatsApp, entra en conversación con **Hero** (ver capacidades y
guardarraíles completos en §6.1). El flujo de reserva:

1. Hero conoce la vivienda vinculada a ese teléfono (dirección y precio). Si un teléfono escribe
   sin vivienda vinculada, Hero no opera: le pide que contacte desde el anuncio de Idealista.
2. El comprador pide horarios → Hero consulta los huecos libres y se los muestra agrupados por día
   (máximo los 15 más próximos; si hay más, lo dice).
3. Para reservar, Hero exige: **nombre, apellidos, email (obligatorio)** y **consentimiento
   explícito a los términos y condiciones** (RGPD, enlace a herohome.es/terminos-y-condiciones).
   El DNI **no** se pide para visitar (solo al ofertar).
4. **Gate de honorarios del comprador** (paso determinista, fuera del LLM): antes de registrar la
   solicitud, el sistema envía un mensaje **verbatim** (no lo redacta la IA) con la comisión de esa
   vivienda — ver texto exacto en §7.3. El comprador debe aceptar de forma inequívoca:
   - Acepta ("sí", "acepto", "vale", "ok", "de acuerdo"…) → se registra el consentimiento en la
     tabla de consentimientos con el **texto exacto que vio** y el identificador del mensaje de
     WhatsApp de aceptación (trazabilidad legal), y solo entonces se reserva.
   - Rechaza ("no", "no acepto", "cancelar") → no se reserva; Hero se despide amablemente.
   - Responde algo ambiguo o una pregunta → se le repregunta una vez; una segunda ambigüedad se
     trata como rechazo.
   - Si la vivienda tiene comisión de comprador del **0%**, el gate se salta y se reserva directo.
   - Durante el gate, el hueco **no** se bloquea (sigue libre). Si al aceptar el hueco ya se ha
     ocupado, se le ofrecen otros. Un gate sin respuesta se limpia a las 24h sin avisar al PC.
5. La reserva pone el hueco en **`Pending to confirm`** y el propietario recibe aviso por dos
   vías: una **notificación in-app en tiempo real** en la PWA ("Nueva solicitud de visita") y un
   **email** con asunto **"Tienes una nueva solicitud de visita"** (vivienda, fecha/hora y
   visitante, con botón para acceder a la app y confirmarla). Hero informa al comprador de que el
   propietario confirmará y de que recibirá el aviso por WhatsApp y email.

### 4.6 El propietario confirma o cancela la visita

El CV ve las solicitudes en la sección Visitas de la PWA (o se las pregunta a Hero en el chat).
Confirmar o cancelar — desde el botón de la app o pidiéndoselo a Hero — pasa siempre por la misma
Edge Function (**`manage-visit`**), que cambia el estado y dispara el aviso al comprador
(**`notify-visit`**):

- **Si confirma** → estado `Confirmed`. El comprador recibe:
  - **WhatsApp**: plantilla `visita_confirmada` (nombre, dirección, fecha/hora). Si la plantilla
    fallara, texto libre equivalente: *"¡Hola {nombre}! Tu visita a {dirección} queda confirmada
    para el {fecha y hora}. ¡Te esperamos! Si necesitas cambiarla, respóndenos por aquí."*
  - **Email** (si dio email): asunto **"Tu visita está confirmada"** — "¡Tu visita está
    confirmada! ✅ Hola {nombre}, hemos confirmado tu visita" + vivienda y fecha/hora + "Si
    necesitas cambiar o cancelar la visita, respóndenos por WhatsApp y te ayudamos enseguida.
    ¡Te esperamos!".
- **Si cancela** → estado `Canceled by owner`. El comprador recibe:
  - **WhatsApp**: plantilla `visita_cancelada`. Fallback de texto: *"Hola {nombre}, lamentamos
    informarte de que tu visita a {dirección} del {fecha y hora} ha sido cancelada. Escríbenos por
    aquí y te ayudamos a reagendarla."*
  - **Email**: asunto **"Tu visita ha sido cancelada"** — "Hola {nombre}, lamentamos informarte de
    que esta visita ha sido cancelada" + detalles + invitación a reagendar por WhatsApp.

Regla de las 24 horas: el propietario no puede cancelar ni reagendar una visita cuando faltan
menos de 24h (la regla se aplica tanto en la app como cuando lo pide por chat a Hero).

### 4.7 El comprador cancela o reagenda

Por WhatsApp, Hero puede cancelar visitas **solo del propio comprador** (las localiza por su
teléfono; si tiene varias, le pregunta cuál). La visita pasa a `Canceled by visitor` (el hueco no
se reabre) y el propietario se entera:

- **Notificación in-app** en tiempo real ("Visita cancelada"), siempre.
- **Email** solo si la visita estaba confirmada: asunto **"Un comprador ha cancelado su
  visita"** — con vivienda, fecha y nombre del comprador, y enlace al panel.

Tras cancelar, Hero ofrece **reagendar** mostrando de nuevo los horarios libres (reagendar =
cancelar una vez + reservar el hueco nuevo, con el mismo flujo de reserva).

### 4.8 Recordatorios de visita

Cada mañana (cron de las 07:00 UTC), el sistema busca las visitas **confirmadas para mañana** y
envía:

- **Al comprador**: plantilla WhatsApp `recordatorio_visita` (nombre, fecha, dirección) + email
  con asunto **"Recordatorio de tu visita de mañana"** ("te recordamos que mañana tienes una
  visita" + detalles + "¡Te esperamos! Si necesitas cambiarla o cancelarla, respóndenos por
  WhatsApp").
- **Al propietario**: email con asunto **"Recordatorio: visita mañana en tu vivienda"** (vivienda,
  fecha/hora y nombre del visitante, con enlace al panel).

### 4.9 Después de la visita

- Un cron nocturno (23:00 UTC) marca como `Completed` las visitas confirmadas que ya pasaron.
- **Follow-up post-visita**: un cron que corre cada 30 minutos detecta las visitas que terminaron
  hace ~1 hora y envía al comprador la plantilla WhatsApp `post_visita`: *"Hola {nombre} 👋 ¿Qué te
  ha parecido la visita a {dirección}? Si quieres hacer una oferta o tienes cualquier duda,
  escríbeme por aquí y te ayudo."* Es idempotente (cada visita recibe un único follow-up) y no es
  retroactivo (solo visitas de las últimas 12 horas). El mensaje se guarda en el historial de la
  conversación para que Hero tenga contexto cuando el comprador responda.
- Con la respuesta del comprador, Hero bifurca:
  - **Le interesa** → flujo de oferta (§4.10).
  - **No le interesa** → Hero pregunta el motivo, lo **sintetiza** y lo guarda en la visita
    (resultado + feedback). Ese feedback lo ve el propietario indirectamente vía equipo/dashboard.

### 4.10 Ofertas y negociación

**El comprador oferta (por WhatsApp).** Hero recoge **importe y DNI** (es el único momento en que
se pide el DNI). Antes de registrar:

- Verifica que existe el **consentimiento de honorarios** del comprador para esa vivienda (lo
  normal, porque se capturó antes de la visita); si por lo que fuera no existiera, se reabre el
  mismo gate. Si falta y aun así se registra, el aviso interno al equipo lo marca.
- Si la vivienda tiene un umbral de "no aceptar ofertas por debajo de X", Hero **avisa** al
  comprador de que quizá no se la acepten, pero **la registra igual** (no hay auto-rechazo).
- Si la vivienda ya tiene una oferta **aceptada** (vivienda apalabrada), el sistema rechaza la
  nueva oferta y Hero se lo explica con tacto.

Al registrarse la oferta (estado `Presented`, iniciada por `Buyer`):

- El propietario recibe **notificación in-app** ("Nueva oferta recibida") y **email**: asunto
  **"Has recibido una nueva oferta"** ("un comprador ha hecho una oferta por tu vivienda" +
  importe + "Entra en tu panel de Herohome para aceptarla, rechazarla o hacer una contraoferta").
- El **equipo** recibe email: asunto **"[Ofertas] Nueva oferta — {dirección}"** con todos los
  datos de gestión (evento, vivienda, importe, comprador, teléfono, email, DNI).

**El propietario decide (desde la PWA, sección Ofertas).** Tres botones — aceptar, rechazar,
contraofertar — que pasan por la Edge Function **`manage-offer`** (la app nunca escribe
directamente en la tabla). En los tres casos se avisa al comprador por WhatsApp + email y al
equipo por email:

| Decisión del CV | Efecto en BD | WhatsApp al PC (plantilla y texto equivalente) | Email al PC (asunto) |
|---|---|---|---|
| **Aceptar** | Oferta → `Accepted` | `oferta_aceptada` — *"¡Enhorabuena {nombre}! El propietario ha aceptado tu oferta de {importe} por {dirección}. Nos pondremos en contacto contigo para los siguientes pasos."* | "¡Tu oferta ha sido aceptada!" (menciona arras y firma digital) |
| **Rechazar** | Oferta → `Denied` | `oferta_rechazada` — *"Hola {nombre}, el propietario no ha aceptado tu oferta por {dirección}. Si quieres, puedes proponer una nueva oferta por aquí."* | "Actualización sobre tu oferta" |
| **Contraofertar** | Oferta del PC → `Denied` + nueva oferta ligada iniciada por `Owner` | `contraoferta` — *"Hola {nombre}, el propietario ha hecho una contraoferta de {importe} por {dirección}. ¿Quieres aceptarla, rechazarla y cerrar la negociación, o hacer una nueva oferta? Escríbeme por aquí."* | "Has recibido una contraoferta" (le deriva a WhatsApp) |

Email al equipo en los tres casos: **"[Ofertas] {Oferta aceptada / Oferta rechazada /
Contraoferta enviada} — {dirección}"**.

**El comprador responde a la contraoferta (por WhatsApp, con Hero):**

- **La acepta** → contraoferta `Accepted`. Email al CV: **"El comprador ha aceptado tu
  contraoferta"** (🤝 con el importe acordado y mención a arras y firma) + notificación in-app +
  email al equipo.
- **La rechaza y cierra** → contraoferta `Denied`. Email al CV: **"El comprador ha rechazado tu
  contraoferta"** + notificación + email al equipo.
- **Hace una nueva oferta** → nueva oferta del comprador ligada a la negociación. Email al CV:
  **"El comprador ha hecho una nueva oferta"** (con el importe, y CTA al panel) + notificación +
  email al equipo. La pelota vuelve al propietario en la PWA.

El ciclo de contraofertas es **multi-vuelta** y continúa hasta que una oferta queda `Accepted` o
la negociación se cierra con `Denied`. Toda la cadena queda ligada (cada contraoferta apunta a la
oferta a la que responde) y es visible en la sección Ofertas de la PWA y en el dashboard.

### 4.11 Después del acuerdo: arras y firma (manual)

Cuando una oferta queda **aceptada** (por cualquiera de los dos caminos), el sistema avisa a todas
las partes y ahí termina la automatización: **una persona del equipo Herohome contacta con
comprador y vendedor** para los siguientes pasos — contrato de arras y firma — que se gestionan en
Salesforce (Docs/Sign Made Easy) de forma manual. Hero se lo explica así a ambos si se lo
preguntan.

---

## 5. La PWA del propietario: qué se puede hacer y qué no

Navegación: cabecera (logo, icono de Mi Equipo, campana de notificaciones) + barra inferior de 4
pestañas: **Hero · Vivienda · Visitas · Ofertas**.

### Qué puede hacer el CV en la PWA

- **Hero (home):** chatear con el agente de la PWA (ver §6.2). Chips de sugerencia al empezar.
- **Vivienda:** ver y **editar los datos de su vivienda**: dirección, tipo, habitaciones, baños,
  planta, superficies, antigüedad, orientación, calefacción, estado, garaje, ascensor, exterior,
  **precio de venta**, **oferta mínima** y gastos de comunidad. Los cambios se guardan en Supabase
  (no vuelven a Salesforce).
- **Visitas:** ver solicitudes pendientes, próximas visitas y pasadas; **confirmar** o **cancelar**
  solicitudes; y editar su **disponibilidad semanal** (los huecos se regeneran al momento).
- **Ofertas:** ver cada oferta y su cadena de negociación, y **aceptar / rechazar /
  contraofertar**.
- **Mi Equipo:** tarjeta de Hero (asistente 24/7) y tarjeta de su **agente humano** (configurable
  por vivienda; con fallback al agente por defecto), con botón **"Solicitar llamada con mi
  agente"** que abre su agenda de Google Calendar. Aquí está también "Cerrar sesión".
- **Campana de notificaciones:** avisos en tiempo real (sin recargar): nueva solicitud de visita,
  visita confirmada, visita cancelada, nueva oferta, oferta actualizada. Cada aviso enlaza a su
  sección.

### Qué NO se puede hacer en la PWA

- **Ver el DNI ni el email del comprador** de una oferta (ocultos por privacidad a nivel de base
  de datos; el nombre y el teléfono sí son visibles — decisión de negocio).
- **Editar los honorarios** de Herohome: el % y el € se muestran en la ficha de la vivienda en
  solo lectura (condición comercial).
- **Crear huecos de visita sueltos** fuera de la plantilla semanal (el generador nocturno los
  eliminaría). Abrir disponibilidad se hace siempre por la plantilla; el bloqueo puntual de un
  rango sí es posible pidiéndoselo a Hero.
- **Escribir directamente** sobre visitas u ofertas: todos los botones de la app pasan por Edge
  Functions con control de propiedad (regla del proyecto: lecturas directas, escrituras siempre
  vía Edge Function).
- Gestionar arras, contrato o firma (eso es del equipo humano + Salesforce).
- El comprador no tiene acceso: la PWA es exclusiva del vendedor.

---

## 6. Los dos agentes de Hero

Hay **dos instancias de Hero**, con el mismo modelo (Claude Sonnet) y la misma arquitectura (bucle
de tool-calling con guardarraíles), pero interlocutores y permisos distintos. Regla común: pueden
**leer** datos directamente, pero cualquier **escritura** pasa por una Edge Function con
validaciones de servidor. Ninguno de los dos puede actuar sobre datos de otra vivienda: el
aislamiento se garantiza en servidor (por el teléfono verificado del comprador, o por la identidad
verificada de la sesión del propietario — nunca por identificadores que envíe el cliente).

### 6.1 Agente de WhatsApp (habla con el comprador)

**Qué puede hacer (sus 6 herramientas):**

| Capacidad | Qué hace |
|---|---|
| Consultar horarios | Lista los huecos libres de la vivienda, agrupados por día (máx. 15) |
| Solicitar visita | Recoge datos + RGPD, dispara el gate de honorarios y, tras la aceptación, reserva (→ `Pending to confirm`) y avisa al CV |
| Cancelar visita | Solo visitas del propio comprador; avisa al CV; ofrece reagendar |
| Crear oferta | Registra la oferta (importe + DNI), con las verificaciones de §4.10 |
| Responder a contraoferta | Acepta o rechaza la contraoferta viva del propietario |
| Guardar feedback post-visita | Registra el resultado y el motivo (sintetizado) en la visita |

**Qué NO puede hacer / guardarraíles:**

- **Anti-alucinación (crítico):** nunca puede afirmar que una visita está reservada/confirmada, ni
  "narrar" que la está procesando, si la herramienta de reserva no tuvo éxito real en ese mismo
  turno. Además del prompt, hay un **guardarraíl en código**: si el texto final afirma una reserva
  sin éxito real, se fuerza una corrección y, si reincide, se sustituye por un mensaje seguro.
  Lo mismo aplica a las acciones de oferta.
- **No inventa** horarios, precios ni datos: todo sale de sus herramientas.
- **No envía emails** ni ejecuta nada fuera de sus herramientas (los avisos los manda el sistema).
- **No decide nada del lado del vendedor**: no confirma visitas ni acepta ofertas en su nombre.
- **El texto legal de honorarios no lo redacta la IA**: el gate es una máquina de estados
  determinista fuera del LLM (texto verbatim + clasificación por palabras de la respuesta).
- **Escalado a humano:** si el comprador pide hablar con una persona, o pregunta algo que Hero no
  puede responder con sus herramientas ni con la conversación (detalles del contrato de arras,
  cuestiones legales o fiscales…), **no se lo inventa**: le pasa el **enlace de agenda** para
  reservar una llamada con el equipo.
- **Contexto funcional:** su prompt incluye un bloque "cómo funciona comprar con Herohome"
  (disponibilidad la define el vendedor; reserva → confirmación del propietario → aviso
  automático; las ofertas las decide el propietario; tras una oferta aceptada, una persona del
  equipo contacta a ambas partes para arras y firma).
- **Sin vivienda vinculada no opera**: redirige a contactar desde el anuncio de Idealista.
- **Protecciones del canal:** solo procesa mensajes auténticos de Meta (firma verificada);
  deduplica mensajes reintentados; responde a Meta al instante y procesa en segundo plano;
  el modelo solo ve los últimos 30 mensajes (el historial completo queda en BD); **límite de
  20 mensajes por teléfono y hora** — al llegar al límite avisa una vez (*"Hemos recibido muchos
  mensajes tuyos en muy poco tiempo, así que voy a hacer una pausa…"*) y por encima guarda
  silencio (protege el coste de la API ante spam o bucles).
- Si el procesamiento falla, el comprador recibe *"Disculpa, he tenido un problema técnico.
  Inténtalo de nuevo en unos minutos."* y el equipo una alerta por email (§9).

### 6.2 Agente de la PWA (habla con el propietario)

**Qué puede hacer (sus 6 herramientas):**

| Capacidad | Qué hace |
|---|---|
| Consultar visitas | Pendientes, próximas y pasadas de su vivienda |
| Consultar disponibilidad | Huecos libres próximos |
| Consultar ofertas | Ofertas y estado de la negociación (solo informativo) |
| Confirmar visita | `Pending to confirm` → `Confirmed` + aviso automático al comprador |
| Cancelar visita | → `Canceled by owner` + aviso al comprador (aplica la regla de 24h) |
| Bloquear huecos | Marca un rango de huecos libres como no disponibles |

**Qué NO puede hacer / guardarraíles:**

- **Confirmación obligatoria:** antes de cualquier acción que cambie datos, describe el cambio y
  espera un "sí" explícito del propietario. Las consultas no la requieren.
- **Ofertas: informa pero NO actúa.** Aceptar/rechazar/contraofertar se hace solo en la sección
  Ofertas. Si el CV le pide consejo sobre una oferta, responde que es una decisión muy relevante y
  le deriva a su asesor.
- **Disponibilidad:** solo bloqueos puntuales. Crear huecos o cambiar la plantilla semanal →
  sección Disponibilidad de la app.
- **Garantista:** ante la duda de si puede o debe hacer algo, no lo hace y deriva al asesor.
- **Escalado a humano:** para hablar con una persona o para preguntas fuera de su alcance
  (legales, fiscales, contractuales), orienta a la sección **"Mi Equipo"** (icono junto a la
  campana) para agendar una llamada con su agente, con el enlace de agenda como alternativa.
- **Anti-alucinación:** guardarraíl en código (acotado a afirmaciones en primera persona: "he
  confirmado/cancelado/bloqueado") — no afirma acciones sin éxito real de la herramienta.
- **Aislamiento:** solo ve y toca la vivienda de la sesión autenticada.
- Si el chat falla, el equipo recibe una alerta por email (§9).

---

## 7. Catálogo de mensajería

### 7.1 Emails (todos por Resend, con plantilla HTML de marca)

| Evento | Destinatario | Asunto | Contenido (resumen en texto plano) |
|---|---|---|---|
| Alta del CV (botón de Salesforce) | CV | **¡Bienvenido a Herohome! Accede a tu cuenta** | "¡Hola, {nombre}! Ya eres parte de Herohome. Tu vivienda está en manos del equipo y desde ahora puedes seguir todo el proceso de venta desde tu cuenta personal. En la app encontrarás los datos de tu vivienda, tu calendario de visitas y las ofertas que vayas recibiendo. Hero, nuestro asistente, estará disponible para resolver cualquier duda. Pulsa el botón para acceder a tu cuenta. El enlace es personal y de un solo uso." Botón: "Acceder a mi cuenta" |
| Login (cada acceso) | CV | **Tu link para acceder a Herohome** | "Pulsa aquí para acceder:" + botón "Ir a Herohome" (lo envía Supabase Auth con plantilla de marca) |
| Nueva solicitud de visita | CV | **Tienes una nueva solicitud de visita** | "un comprador ha solicitado una visita a tu vivienda y está esperando tu confirmación" + vivienda, fecha/hora y visitante + "Accede a tu área privada para confirmar la visita." + botón a la app |
| Visita confirmada | PC | **Tu visita está confirmada** | "¡Tu visita está confirmada! ✅ Hola {nombre}, hemos confirmado tu visita" + vivienda y fecha/hora + "Si necesitas cambiar o cancelar la visita, respóndenos por WhatsApp y te ayudamos enseguida. ¡Te esperamos!" |
| Visita cancelada por el propietario | PC | **Tu visita ha sido cancelada** | "Hola {nombre}, lamentamos informarte de que esta visita ha sido cancelada" + detalles + "Si quieres, escríbenos por WhatsApp y te ayudamos a reagendarla en otro horario que te venga mejor." |
| Visita cancelada por el comprador (solo si estaba confirmada) | CV | **Un comprador ha cancelado su visita** | "te informamos de que un comprador ha cancelado una visita que tenías confirmada en tu vivienda" + vivienda, fecha y comprador + botón a la app |
| Recordatorio (día antes) | PC | **Recordatorio de tu visita de mañana** | "Hola {nombre}, te recordamos que mañana tienes una visita" + vivienda y fecha/hora + "¡Te esperamos! Si necesitas cambiarla o cancelarla, respóndenos por WhatsApp." |
| Recordatorio (día antes) | CV | **Recordatorio: visita mañana en tu vivienda** | "te recordamos que mañana tienes una visita programada en tu vivienda" + vivienda, fecha/hora y visitante + botón a la app |
| Nueva oferta del comprador | CV | **Has recibido una nueva oferta** | "un comprador ha hecho una oferta por tu vivienda" + vivienda e importe + "Entra en tu panel de Herohome para aceptarla, rechazarla o hacer una contraoferta." |
| Nueva oferta del comprador en negociación | CV | **El comprador ha hecho una nueva oferta** | "el comprador ha respondido a tu contraoferta con una nueva oferta" + importe + CTA al panel |
| Oferta aceptada por el CV | PC | **¡Tu oferta ha sido aceptada!** | "¡buenas noticias! El propietario ha aceptado tu oferta" + vivienda e importe + "Nos pondremos en contacto contigo muy pronto para los siguientes pasos (contrato de arras y firma digital)." |
| Oferta rechazada por el CV | PC | **Actualización sobre tu oferta** | "el propietario no ha aceptado tu oferta por esta vivienda" + "Si quieres, puedes proponer una nueva oferta escribiéndonos por WhatsApp." |
| Contraoferta del CV | PC | **Has recibido una contraoferta** | "el propietario ha respondido a tu oferta con una contraoferta" + importe + "Revisa tu WhatsApp para aceptarla, rechazarla o proponer una nueva oferta. Si lo prefieres, también puedes escribirnos a hola@herohome.es." |
| Contraoferta aceptada por el PC | CV | **El comprador ha aceptado tu contraoferta** | "buenas noticias: el comprador ha aceptado tu contraoferta 🤝" + importe acordado + "Nos pondremos en contacto contigo y con el comprador para los siguientes pasos (contrato de arras y firma)." + botón a la app |
| Contraoferta rechazada por el PC | CV | **El comprador ha rechazado tu contraoferta** | "el comprador ha rechazado tu contraoferta y ha cerrado la negociación por esta vivienda" + botón a la app |
| Cada movimiento de oferta (interno) | Equipo (hola@herohome.es) | **[Ofertas] {evento} — {dirección}** | Ficha de gestión: evento, vivienda, importe, comprador, teléfono, email, DNI (+ nota si falta el reconocimiento de honorarios). "Si la oferta está aceptada, contacta con el comprador para el contrato de arras." |
| Fallo procesando un lead de Idealista | Equipo | **⚠️ Fallo al procesar lead de Idealista** | Motivo del fallo, datos extraídos y email original, para gestión manual |
| Alerta técnica (cualquier origen) | Equipo | **⚠️ [Herohome] {origen}: {resumen}** | Detalle del error (ver §9) |

### 7.2 Plantillas de WhatsApp (aprobadas en Meta, idioma es_ES)

Las plantillas permiten iniciar conversación fuera de la ventana de 24 horas de WhatsApp. Dentro de
la ventana, si el envío de plantilla falla, el sistema recurre a un texto libre equivalente (los
textos de la tabla). Ninguna lleva botones: el comprador responde con texto libre y Hero interpreta.

| Plantilla | Cuándo se envía | Parámetros | Texto |
|---|---|---|---|
| `bienvenida_pc` | Al procesar un lead de Idealista | {{1}} dirección | Bienvenida a Herohome como interesado en la vivienda {{1}}, invitando a seguir por este chat (copy exacto en el WABA de Meta) |
| `visita_confirmada` | El CV confirma la visita | {{1}} nombre, {{2}} dirección, {{3}} fecha/hora | "¡Hola {{1}}! Tu visita a {{2}} queda confirmada para el {{3}}. ¡Te esperamos! Si necesitas cambiarla, respóndenos por aquí." |
| `visita_cancelada` | El CV cancela la visita | {{1}} nombre, {{2}} dirección, {{3}} fecha/hora | "Hola {{1}} 👋, lamentamos informarte de que tu visita a {{2}} del {{3}} ha sido cancelada por el propietario. Escríbenos por aquí y te ayudamos a reagendarla." |
| `recordatorio_visita` | La mañana del día anterior a una visita confirmada | {{1}} nombre, {{2}} fecha, {{3}} dirección | Recordatorio de la visita de mañana {{2}} en {{3}} |
| `post_visita` | ~1 hora después de terminar la visita | {{1}} nombre, {{2}} dirección | "Hola {{1}} 👋 ¿Qué te ha parecido la visita a {{2}}? Si quieres hacer una oferta o tienes cualquier duda, escríbeme por aquí y te ayudo." |
| `oferta_aceptada` | El CV acepta la oferta | {{1}} nombre, {{2}} importe, {{3}} dirección | "¡Enhorabuena {{1}}! 🎉 El propietario ha aceptado tu oferta de {{2}} por {{3}}. Nos pondremos en contacto contigo para los siguientes pasos (arras y firma)." |
| `oferta_rechazada` | El CV rechaza la oferta | {{1}} nombre, {{2}} dirección | "Hola {{1}}, el propietario no ha aceptado tu oferta por {{2}}. Si quieres, puedes proponer una nueva oferta por aquí." |
| `contraoferta` | El CV contraoferta | {{1}} nombre, {{2}} importe, {{3}} dirección | "Hola {{1}}, el propietario ha hecho una contraoferta de {{2}} por {{3}}. ¿Quieres aceptarla, rechazarla y cerrar la negociación, o hacer una nueva oferta? Escríbeme por aquí." |

> El copy exacto y vigente de cada plantilla vive en el WABA de Meta (las plantillas pertenecen a
> la cuenta de WhatsApp Business, no a la app). Los textos de la tabla son los equivalentes que
> usa el código como fallback y el borrador aprobado. Convención: toda plantilla nueva se crea en
> idioma **es_ES** ("Spanish (SPA)").

### 7.3 Mensajes fijos del agente de WhatsApp (texto libre, no plantillas)

**Gate de honorarios** (verbatim, generado por código con el % y el precio de la vivienda):

> Antes de confirmar tu visita, necesito que conozcas las condiciones del servicio:
>
> Herohome cobra una comisión del {X}% sobre el precio de venta al comprador. Esta comisión se
> devenga si formalizas una oferta de compra sobre esta propiedad que es aceptada por el vendedor.
> Sobre el precio actual de {precio} €, supondría aproximadamente {importe} €; el importe final se
> calculará sobre el precio que finalmente se acuerde con el vendedor.
>
> Puedes consultar las condiciones completas en: herohome.es/honorarios
>
> ¿Aceptas estas condiciones para continuar? Responde SÍ para confirmar tu visita.

Y sus respuestas asociadas:

- **Reserva completada tras aceptar:** "¡Perfecto! Tu solicitud de visita ha quedado registrada.
  El propietario la confirmará en breve y recibirás el aviso por WhatsApp y por email. ¡Gracias
  por confiar en Herohome!"
- **Rechazo del gate:** "Entendido, no hay problema. Si cambias de opinión o quieres saber más
  sobre cómo funciona Herohome, escríbeme cuando quieras."
- **El hueco se ocupó mientras tanto:** "Vaya, ese horario acaba de ocuparse. ¿Quieres que te
  muestre otros huecos disponibles para tu visita?"
- **Fallo técnico registrando el consentimiento:** "Ha habido un problema técnico al procesar tu
  solicitud. Por favor, inténtalo de nuevo en unos minutos o escríbenos a hola@herohome.es."
- **Límite de mensajes alcanzado:** "Hemos recibido muchos mensajes tuyos en muy poco tiempo, así
  que voy a hacer una pausa. Vuelve a escribirme dentro de un rato o contáctanos en
  hola@herohome.es."
- **Error general del agente:** "Disculpa, he tenido un problema técnico. Inténtalo de nuevo en
  unos minutos."

El resto de la conversación (saludos, respuestas, explicación de horarios…) lo redacta Hero
libremente dentro de sus reglas.

### 7.4 Notificaciones in-app (campana de la PWA, en tiempo real)

| Tipo | Cuándo | Enlaza a |
|---|---|---|
| Nueva solicitud de visita | Un comprador reserva un hueco | Visitas (pendientes) |
| Visita cancelada | El comprador cancela su visita | Visitas |
| Nueva oferta recibida | Oferta del comprador | Ofertas |
| Oferta actualizada | Movimiento en la negociación (respuesta del comprador a una contraoferta, decisión registrada) | Ofertas |

> La interfaz también reconoce un tipo "Visita confirmada", pero hoy ningún flujo lo emite (quien
> confirma es el propio propietario; el aviso de confirmación va al comprador por WhatsApp/email).

---

## 8. Seguridad y privacidad (a alto nivel)

- **Cada canal de entrada tiene su autenticación:** la PWA opera con la sesión del usuario (JWT);
  el webhook de WhatsApp solo acepta mensajes con la firma criptográfica de Meta; los crons y las
  llamadas internas entre funciones usan una clave interna de API; el dashboard de operaciones
  exige usuario administrador.
- **Aislamiento por usuario:** la base de datos tiene seguridad a nivel de fila (cada propietario
  solo ve sus datos) y, además, toda escritura pasa por Edge Functions que verifican en servidor
  que el actor es dueño del dato que toca.
- **Privacidad del comprador:** el DNI y el email del comprador quedan ocultos al propietario a
  nivel de base de datos (los ve solo el equipo). El consentimiento RGPD se pide antes de reservar
  y el reconocimiento de honorarios queda registrado con el texto exacto mostrado y el mensaje de
  aceptación (trazabilidad para una eventual reclamación).
- **El texto con consecuencias legales nunca lo genera la IA** (gate determinista).
- Sin secretos en el código ni en el navegador: las claves viven como secrets del backend.

---

## 9. Qué pasa cuando algo falla (avisos y monitorización)

El principio es que **nada falla en silencio hacia el equipo**:

1. **Alertas por email** a `hola@herohome.es` (asunto "⚠️ [Herohome] {origen}: {resumen}") ante:
   - Excepciones no controladas en los crons (recordatorios, post-visita, generación de huecos) y
     fallos de sus consultas a BD.
   - Fallos de envío agregados: si varios WhatsApp/emails de una pasada fallan, llega **un** email
     con el listado (no uno por fallo).
   - Errores de los dos agentes conversacionales (el canal de venta no se cae en silencio).
   - WhatsApp salientes no entregados (con el código de error de Meta).
   - Leads de Idealista que no se pudieron procesar (alerta específica con los datos, §4.4).
2. **Dead-man's-switch (Healthchecks.io):** las alertas anteriores cubren "el cron falló", pero no
   "el cron no llegó a ejecutarse". Para eso, cada cron hace ping a Healthchecks.io al terminar
   bien (o a su endpoint de fallo si revienta); si un check no recibe su ping a la hora esperada,
   Healthchecks avisa al equipo. Es fail-open: si Healthchecks no responde, el cron sigue su curso.
3. **Degradación amable de cara al usuario:** si una plantilla de WhatsApp falla dentro de la
   ventana de 24h, se envía el texto libre equivalente; si el envío post-visita falla, el cron lo
   reintenta en la siguiente pasada; los dos agentes **reintentan automáticamente** (hasta 3
   intentos con espera creciente) ante errores transitorios del proveedor de IA antes de rendirse
   y alertar; y si aun así el agente falla, el comprador recibe un mensaje honesto de error
   técnico (nunca una respuesta inventada).
4. **Ingesta de Idealista autorreparable:** un lead que falla por un problema técnico queda en el
   buzón sin etiquetar y se reintenta automáticamente al minuto siguiente; los fallos de negocio
   (extracción imposible, vivienda no encontrada) generan la alerta al equipo del §4.4. Además,
   Google avisa por email si el disparador del script deja de ejecutarse.
5. **Fallos visibles en la PWA:** las acciones del propietario (confirmar visita, responder
   oferta…) muestran el error en pantalla; esas funciones no necesitan alertar al equipo porque el
   usuario ya lo ve.
6. **Dashboard de operaciones** (§10) como vista de control diaria.

---

## 10. Dashboard de operaciones (admin.herohome.es)

Panel **de solo lectura** para el equipo, en producción:

- **Acceso:** login con email y contraseña (Supabase Auth); solo entran las cuentas dadas de alta
  como administradoras. Una cuenta no admin es expulsada tras el login.
- **Sección "Para hoy":** visitas de hoy (en cualquier estado), solicitudes de visita pendientes
  de confirmar y ofertas presentadas **indicando a quién le toca responder**.
- **Tarjeta por vivienda:** dirección, precio, propietario con teléfono y email, honorarios,
  visitas con su estado y el feedback post-visita, y ofertas con la cadena de negociación
  completa.
- **Refresco:** automático configurable (de 30 min a 6 h) + botón manual.
- **Privacidad:** ni siquiera el dashboard muestra el DNI/email del comprador de las ofertas
  (columnas protegidas).

El dashboard no permite operar (no se confirma ni se decide nada desde ahí). Para intervención
manual de datos, el equipo usa el Table Editor de Supabase.

---

## 11. Tareas programadas (crons)

| Hora (UTC) | Tarea | Qué hace |
|---|---|---|
| 02:00 diario | Limpieza | Borra huecos pasados que nadie reservó; marca como no disponibles las solicitudes cuyo horario expiró sin confirmarse; limpia gates de honorarios sin respuesta (>24h); purga registros técnicos antiguos del webhook |
| 03:00 diario | Generación de huecos | Sincroniza la ventana móvil de 14 días de huecos de visita para todas las viviendas en venta (§4.3) |
| 07:00 diario | Recordatorios | Recordatorio de las visitas confirmadas de mañana: WhatsApp + email al PC, email al CV (§4.8) |
| 23:00 diario | Cierre de visitas | Marca como realizadas (`Completed`) las visitas confirmadas que ya pasaron |
| Cada 30 min | Post-visita | Envía el follow-up de WhatsApp ~1h después de cada visita (§4.9) |

Todos hacen ping al dead-man's-switch y alertan al equipo si fallan (§9).

---

## 12. Lo que el sistema NO hace (límites de diseño vigentes)

- **No sincroniza nada de vuelta a Salesforce.** Los cambios de precio, visitas u ofertas viven
  solo en Supabase. Salesforce está congelado: solo alta inicial (botón "Enviar acceso PWA") y
  contratos/firma.
- **No automatiza arras ni firma:** tras una oferta aceptada, el proceso es humano.
- **No reabre huecos cancelados:** una visita cancelada no devuelve el hueco a disponible.
- **No rechaza ofertas automáticamente** por debajo del umbral del propietario: avisa y registra.
- **No usa botones en WhatsApp** ni encuestas estructuradas: el comprador escribe libre y Hero
  interpreta.
- **Hero no da consejo legal, fiscal ni de negociación** — deriva al asesor humano.
- **El comprador no tiene app**: toda su relación es por WhatsApp y email.
- **No hay staging:** hay un único entorno, que es producción.

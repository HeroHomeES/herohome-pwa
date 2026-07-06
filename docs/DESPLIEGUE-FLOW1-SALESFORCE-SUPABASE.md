# Despliegue a Producción — Salesforce Flow 1: "Enviar acceso a la PWA"

> Documento de referencia para Claude Code.
> Generado en conversación de diseño e implementación (julio 2026).
> Entorno origen: Sandbox `developer2` (Org ID: 00DPw00000HS80rMAD)
> Entorno destino: Producción

---

## ⚠️ Nota de Claude Code (añadida al incorporar el doc al repo — julio 2026)

Este documento se generó en una conversación de Claude chat y captura bien el **diseño y la
configuración de Salesforce** (Named Credential, LWC, Quick Action, campos, Quick Action). Se
incorpora como **runbook de referencia del lado Salesforce**, que el repo no tenía. Pero **parte
del contenido quedó desactualizado** respecto a lo que hoy está en producción. Antes de usarlo,
tener en cuenta:

1. **Honorarios (fee) — el mapeo del Apex del doc es OBSOLETO.** El doc envía las claves
   `ownerFee`/`buyerFee` y la Edge Function del doc escribe directamente `owner_fee`/`buyer_fee`.
   **En producción (fix del 26 jun 2026):** el Apex mapea `Owner_fee__c → ownerFeePercent` y
   `Buyer_fee__c → buyerFeePercent` (esos campos SF contienen el **porcentaje**, no el importe), y
   en Supabase `owner_fee`/`buyer_fee` (€) son **columnas GENERATED** que calcula Postgres solo —
   **nunca se escriben desde el Apex ni la función**. Ver `supabase/functions/create-user/index.ts`
   y `supabase/sql/2026-06-26-fee-fields.sql`.
2. **El código de la Edge Function del §2.7 es una versión antigua.** La real (`create-user`) hace
   `upsert` idempotente (no INSERT), exige `salesforceAccountId` + `email` + `firstName` +
   `lastName`, acepta nombres de campo alternativos (`first_name`/`firstName`, `usefulSurface`/
   `usefulSurfaceArea`…), y **envía el email de bienvenida vía Resend inline** (no genera solo un
   Magic Link). **Fuente de verdad = el código del repo, no este doc.**
3. **Supabase ya está en producción y validado e2e** (26 y 30 jun). **Solo hay un proyecto Supabase
   = producción, no hay staging** (`zqkvcphtqmibttgnivku`). El "despliegue" pendiente es solo el
   **lado Salesforce: sandbox `developer2` → Salesforce producción**, apuntando a esa misma Supabase.
4. **Salesforce está CONGELADO** (arquitectura v3.1): su único rol es el Flow 1 (botón "Enviar
   acceso PWA"). No se crean campos/Flows/Apex nuevos; solo se despliega lo ya existente.
5. La incidencia **"PWA_Access_Sent__c no se actualiza"** (§6.1) seguía abierta en el doc; verificar
   al validar en producción.

> Fuentes autoritativas: `CLAUDE.md` (registro de sesiones 24-30 jun),
> `supabase/functions/create-user/index.ts`, `supabase/sql/2026-06-26-fee-fields.sql`.

---

## 1. Resumen ejecutivo

Se ha implementado un botón "Enviar acceso PWA" en la página del objeto Account de Salesforce. Al pulsarlo, ejecuta un callout HTTP a una Edge Function de Supabase que:

1. Crea un usuario en Supabase Auth (con role "seller")
2. Inserta un registro en la tabla `users` de Supabase
3. Inserta un registro en la tabla `properties` de Supabase con todos los datos de la vivienda
4. Genera un Magic Link y lo devuelve en la respuesta

El botón muestra un popup de confirmación antes de ejecutar, y después muestra un toast verde (éxito) o rojo (error) al usuario.

---

## 2. Componentes desarrollados

### 2.1. Salesforce — Apex Class: `HerohomeSupabaseCallout`

**Ubicación:** Setup → Apex Classes → HerohomeSupabaseCallout
**Tipo:** Clase Apex con dos métodos públicos

**Método 1 — `enviarAccesoPWA` (para Flows):**
- Anotación: `@InvocableMethod`
- Input: `List<String> accountIds`
- Output: `List<ResultadoCallout>`

**Método 2 — `enviarAccesoPWADesdeUI` (para LWC):**
- Anotación: `@AuraEnabled`
- Input: `String accountId`
- Output: `ResultadoCallout`
- Llama internamente al método 1

**Método privado — `procesarCallout`:**
- Hace GET del Account (vivienda) y del Contact asociado (propietario)
- Construye un payload JSON con dos objetos: `user` y `property`
- Ejecuta HTTP POST a Supabase via Named Credential
- Si éxito (200/201): marca `PWA_Access_Sent__c = true` en el Contact
- Si error: crea una Task en Salesforce con el detalle del error

**Clase wrapper — `ResultadoCallout`:**
- `exito` (Boolean) — anotado con `@AuraEnabled` y `@InvocableVariable`
- `mensaje` (String) — anotado con `@AuraEnabled` y `@InvocableVariable`
- `statusCode` (Integer) — anotado con `@AuraEnabled` y `@InvocableVariable`

**Código completo:**

```apex
public class HerohomeSupabaseCallout {

    @InvocableMethod(label='Enviar acceso PWA a Supabase' 
                     description='Crea usuario y propiedad en Supabase y envia Magic Link')
    public static List<ResultadoCallout> enviarAccesoPWA(List<String> accountIds) {
        List<ResultadoCallout> resultados = new List<ResultadoCallout>();
        for (String accountId : accountIds) {
            ResultadoCallout resultado = procesarCallout(accountId);
            resultados.add(resultado);
        }
        return resultados;
    }

    @AuraEnabled
    public static ResultadoCallout enviarAccesoPWADesdeUI(String accountId) {
        List<String> ids = new List<String>{ accountId };
        List<ResultadoCallout> resultados = enviarAccesoPWA(ids);
        return resultados[0];
    }
    
    private static ResultadoCallout procesarCallout(String accountId) {
        ResultadoCallout resultado = new ResultadoCallout();
        
        try {
            Account vivienda = [
                SELECT Id, BillingStreet, BillingPostalCode, BillingState, BillingCity,
                       Description, Age__c, Bathrooms__c, Built_area__c, Buyer_fee__c,
                       Owner_fee__c,
                       Community_fee__c, Condition_of_the_property__c, Electronic_certificate__c,
                       External__c, Garage_space__c, Heating_type__c, High__c, Housing_type__c,
                       It_has_an_elevator__c, Orientation__c, Ref_Catastral__c,
                       Registro_propiedad_n_mero__c, Reject_offers_below__c, Rooms__c,
                       Sales_price__c, Status__c, Useful_surface_area__c, Floor__c
                FROM Account WHERE Id = :accountId LIMIT 1
            ];
            
            Contact propietario = [
                SELECT Id, FirstName, LastName, Email, DNI__c, MobilePhone
                FROM Contact WHERE AccountId = :accountId LIMIT 1
            ];
            
            Map<String, Object> user = new Map<String, Object>();
            user.put('first_name', propietario.FirstName);
            user.put('last_name',  propietario.LastName);
            user.put('email',      propietario.Email);
            user.put('dni',        propietario.DNI__c);
            user.put('phone',      propietario.MobilePhone);
            user.put('contactId',  propietario.Id);
            
            Map<String, Object> property = new Map<String, Object>();
            property.put('salesforceAccountId',   vivienda.Id);
            property.put('street',                vivienda.BillingStreet);
            property.put('postalCode',            vivienda.BillingPostalCode);
            property.put('state',                 vivienda.BillingState);
            property.put('city',                  vivienda.BillingCity);
            property.put('description',           vivienda.Description);
            property.put('age',                   vivienda.Age__c);
            property.put('bathrooms',             vivienda.Bathrooms__c);
            property.put('builtArea',             vivienda.Built_area__c);
            property.put('buyerFee',              vivienda.Buyer_fee__c);
            property.put('ownerFee',              vivienda.Owner_fee__c);
            property.put('communityFee',          vivienda.Community_fee__c);
            property.put('condition',             vivienda.Condition_of_the_property__c);
            property.put('electronicCertificate', vivienda.Electronic_certificate__c);
            property.put('external',              vivienda.External__c);
            property.put('garageSpace',           vivienda.Garage_space__c);
            property.put('heatingType',           vivienda.Heating_type__c);
            property.put('high',                  vivienda.High__c);
            property.put('housingType',           vivienda.Housing_type__c);
            property.put('elevator',              vivienda.It_has_an_elevator__c);
            property.put('orientation',           vivienda.Orientation__c);
            property.put('refCatastral',          vivienda.Ref_Catastral__c);
            property.put('registroPropiedad',     vivienda.Registro_propiedad_n_mero__c);
            property.put('rejectOffersBelow',     vivienda.Reject_offers_below__c);
            property.put('rooms',                 vivienda.Rooms__c);
            property.put('salesPrice',            vivienda.Sales_price__c);
            property.put('status',                vivienda.Status__c);
            property.put('usefulSurface',         vivienda.Useful_surface_area__c);
            property.put('floor',                 vivienda.Floor__c);
            
            Map<String, Object> payload = new Map<String, Object>();
            payload.put('user',     user);
            payload.put('property', property);
            
            String jsonBody = JSON.serialize(payload);
            
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:Supabase_Herohome/functions/v1/create-user');
            req.setMethod('POST');
            req.setHeader('Content-Type', 'application/json');
            req.setBody(jsonBody);
            req.setTimeout(30000);
            
            Http http = new Http();
            HttpResponse res = http.send(req);
            
            if (res.getStatusCode() == 200 || res.getStatusCode() == 201) {
                Contact c = new Contact(
                    Id = propietario.Id,
                    PWA_Access_Sent__c = true,
                    PWA_Access_Sent_Date__c = DateTime.now()
                );
                update c;
                resultado.exito = true;
                resultado.mensaje = 'Acceso enviado correctamente a ' + propietario.Email;
                resultado.statusCode = res.getStatusCode();
            } else {
                resultado.exito = false;
                resultado.mensaje = 'Error en Supabase. Codigo: ' + res.getStatusCode() + ' | Respuesta: ' + res.getBody();
                resultado.statusCode = res.getStatusCode();
                crearTareaError(propietario.Id, accountId, res.getStatusCode(), res.getBody());
            }
            
        } catch (QueryException e) {
            resultado.exito = false;
            resultado.mensaje = 'No se encontraron datos. Verifica que el Account tiene un Contact asociado. Error: ' + e.getMessage();
            resultado.statusCode = 0;
        } catch (CalloutException e) {
            resultado.exito = false;
            resultado.mensaje = 'Error de conexion con Supabase: ' + e.getMessage();
            resultado.statusCode = 0;
        }
        
        return resultado;
    }
    
    private static void crearTareaError(String contactId, String accountId, Integer statusCode, String responseBody) {
        Task t = new Task(
            Subject     = 'ERROR: Fallo al enviar acceso PWA',
            Description = 'Status code: ' + statusCode + '\nRespuesta: ' + responseBody,
            WhoId       = contactId,
            WhatId      = accountId,
            Status      = 'Not Started',
            Priority    = 'High'
        );
        insert t;
    }
    
    public class ResultadoCallout {
        @AuraEnabled
        @InvocableVariable(label='Exito' description='true si el callout fue correcto')
        public Boolean exito;
        
        @AuraEnabled
        @InvocableVariable(label='Mensaje' description='Mensaje de confirmacion o error')
        public String mensaje;
        
        @AuraEnabled
        @InvocableVariable(label='Status Code' description='Codigo HTTP de respuesta')
        public Integer statusCode;
    }
}
```

---

### 2.2. Salesforce — Apex Test Class: `HerohomeSupabaseCalloutTest`

**Ubicacion:** Setup → Apex Classes → HerohomeSupabaseCalloutTest
**Cobertura:** 4 tests — callout exitoso (Flow), callout exitoso (LWC/UI), callout error, sin Contact asociado

**Codigo completo:**

```apex
@isTest
public class HerohomeSupabaseCalloutTest {
    
    private class SupabaseMockExito implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"success":true,"user_id":"abc-123","magic_link":"https://test.com","magic_link_error":null}');
            res.setStatusCode(201);
            return res;
        }
    }
    
    private class SupabaseMockError implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"error":"Email already exists"}');
            res.setStatusCode(422);
            return res;
        }
    }
    
    private static Account crearAccountTest() {
        Account acc = new Account(
            Name      = 'Test Vivienda',
            Status__c = 'On sale'
        );
        insert acc;
        return acc;
    }
    
    private static Contact crearContactTest(String accountId) {
        Contact c = new Contact(
            FirstName   = 'Juan',
            LastName    = 'Garcia',
            Email       = 'juan.garcia@test.com',
            DNI__c      = '12345678A',
            AccountId   = accountId
        );
        insert c;
        return c;
    }
    
    @isTest
    static void testCalloutExitoso() {
        Account acc = crearAccountTest();
        Contact con = crearContactTest(acc.Id);
        
        Test.setMock(HttpCalloutMock.class, new SupabaseMockExito());
        
        Test.startTest();
        List<String> accountIds = new List<String>{ acc.Id };
        List<HerohomeSupabaseCallout.ResultadoCallout> resultados = 
            HerohomeSupabaseCallout.enviarAccesoPWA(accountIds);
        Test.stopTest();
        
        System.assertEquals(1, resultados.size());
        System.assertEquals(true, resultados[0].exito);
        System.assertEquals(201, resultados[0].statusCode);
    }
    
    @isTest
    static void testCalloutExitosoDesdeUI() {
        Account acc = crearAccountTest();
        Contact con = crearContactTest(acc.Id);
        
        Test.setMock(HttpCalloutMock.class, new SupabaseMockExito());
        
        Test.startTest();
        HerohomeSupabaseCallout.ResultadoCallout resultado = 
            HerohomeSupabaseCallout.enviarAccesoPWADesdeUI(acc.Id);
        Test.stopTest();
        
        System.assertEquals(true, resultado.exito);
        System.assertEquals(201, resultado.statusCode);
    }
    
    @isTest
    static void testCalloutError() {
        Account acc = crearAccountTest();
        Contact con = crearContactTest(acc.Id);
        
        Test.setMock(HttpCalloutMock.class, new SupabaseMockError());
        
        Test.startTest();
        List<String> accountIds = new List<String>{ acc.Id };
        List<HerohomeSupabaseCallout.ResultadoCallout> resultados = 
            HerohomeSupabaseCallout.enviarAccesoPWA(accountIds);
        Test.stopTest();
        
        System.assertEquals(1, resultados.size());
        System.assertEquals(false, resultados[0].exito);
        System.assertEquals(422, resultados[0].statusCode);
        
        List<Task> tareas = [SELECT Subject FROM Task WHERE WhatId = :acc.Id];
        System.assertEquals(1, tareas.size());
    }
    
    @isTest
    static void testSinContactAsociado() {
        Account acc = crearAccountTest();
        
        Test.setMock(HttpCalloutMock.class, new SupabaseMockExito());
        
        Test.startTest();
        List<String> accountIds = new List<String>{ acc.Id };
        List<HerohomeSupabaseCallout.ResultadoCallout> resultados = 
            HerohomeSupabaseCallout.enviarAccesoPWA(accountIds);
        Test.stopTest();
        
        System.assertEquals(false, resultados[0].exito);
    }
}
```

---

### 2.3. Salesforce — LWC: `enviarAccesoPwa`

**Ubicacion:** `force-app/main/default/lwc/enviarAccesoPwa/`
**Funcion:** Popup de confirmacion + toast de resultado. Se invoca como Quick Action desde la pagina del Account.

**Fichero 1 — `enviarAccesoPwa.html`:**

```html
<template>
    <lightning-quick-action-panel header="Enviar acceso PWA">
        <p>¿Confirmas que quieres enviar el acceso a la PWA a este cliente?</p>
        <div slot="footer">
            <lightning-button
                label="Cancelar"
                onclick={handleCancel}
                class="slds-m-right_x-small">
            </lightning-button>
            <lightning-button
                variant="brand"
                label={botonLabel}
                onclick={handleEnviar}
                disabled={cargando}>
            </lightning-button>
        </div>
    </lightning-quick-action-panel>
</template>
```

**Fichero 2 — `enviarAccesoPwa.js`:**

```javascript
import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { CloseActionScreenEvent } from 'lightning/actions';
import enviarAccesoPWADesdeUI from '@salesforce/apex/HerohomeSupabaseCallout.enviarAccesoPWADesdeUI';

export default class EnviarAccesoPwa extends LightningElement {
    @api recordId;
    cargando = false;

    get botonLabel() {
        return this.cargando ? 'Enviando...' : 'Confirmar y enviar';
    }

    handleCancel() {
        this.dispatchEvent(new CloseActionScreenEvent());
    }

    async handleEnviar() {
        this.cargando = true;
        try {
            const resultado = await enviarAccesoPWADesdeUI({ accountId: this.recordId });
            
            if (resultado.exito) {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Acceso enviado',
                    message: resultado.mensaje,
                    variant: 'success'
                }));
            } else {
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Error al enviar acceso',
                    message: resultado.mensaje,
                    variant: 'error',
                    mode: 'sticky'
                }));
            }
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error inesperado',
                message: error.body?.message || 'Contacta con el administrador',
                variant: 'error',
                mode: 'sticky'
            }));
        } finally {
            this.cargando = false;
            this.dispatchEvent(new CloseActionScreenEvent());
        }
    }
}
```

**Fichero 3 — `enviarAccesoPwa.js-meta.xml`:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>59.0</apiVersion>
    <isExposed>true</isExposed>
    <targets>
        <target>lightning__RecordAction</target>
        <target>lightning__RecordPage</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__RecordAction">
            <actionType>Action</actionType>
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>
```

---

### 2.4. Salesforce — External Credential + Named Credential

**External Credential:**
- Label: `Supabase_EC`
- Name: `Supabase_EC`
- Authentication Protocol: `Custom`
- Principal Name: `SupabaseAdmin`
- Custom Headers:
  - `apikey` = Supabase anon key (empieza por `eyJ...`)
  - `Authorization` = `Bearer` + espacio + misma anon key

**Named Credential:**
- Label: `Supabase_Herohome`
- Name: `Supabase_Herohome`
- URL: `https://zqkvcphtqmibttgnivku.supabase.co`
- External Credential: `Supabase_EC`
- Generate Authorization Header: `false` (desactivado)

**Permission Set / Profile:**
- El perfil System Administrator tiene acceso al External Credential Principal (`Supabase_EC - SupabaseAdmin`) via External Credential Principal Access.

---

### 2.5. Salesforce — Quick Action

- Objeto: `Account`
- Action Type: `Lightning Web Component`
- Lightning Web Component: `c:enviarAccesoPwa`
- Label: `Enviar acceso PWA`
- Ubicada en la barra de acciones rapidas del Page Layout del Account

---

### 2.6. Salesforce — Campos custom creados

**En Contact:**
- `PWA_Access_Sent__c` (Checkbox) — indica si se envio el acceso
- `PWA_Access_Sent_Date__c` (DateTime) — fecha/hora del envio

**Nota:** Estos campos tambien se crearon por error en Account. En produccion, crearlos solo en Contact.

---

### 2.7. Supabase — Edge Function: `create-user`

**Nombre en dashboard:** create-user-and-property
**URL real (slug):** `https://zqkvcphtqmibttgnivku.supabase.co/functions/v1/create-user`
**IMPORTANTE:** El slug de la URL es `create-user` (heredado), no `create-user-and-property`. La clase Apex apunta a `/functions/v1/create-user`.

**Codigo completo:**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function toIntOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.floor(n);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { user, property } = payload;

  if (!user?.email || !user?.first_name || !user?.last_name) {
    return new Response(
      JSON.stringify({ error: "user.email, user.first_name and user.last_name are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!property?.salesforceAccountId) {
    return new Response(
      JSON.stringify({ error: "property.salesforceAccountId is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Crear usuario en Supabase Auth
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email: user.email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: {
        first_name: user.first_name,
        last_name: user.last_name,
        role: "seller",
      },
    });

  if (authError || !authData.user) {
    return new Response(
      JSON.stringify({ error: authError?.message ?? "Auth user creation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const userId = authData.user.id;

  // 2. Insertar en tabla users
  const { error: userDbError } = await supabase.from("users").insert({
    id: userId,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    dni: user.dni ?? null,
    phone: user.phone ?? null,
    salesforce_contact_id: user.contactId ?? null,
    salesforce_account_id: property.salesforceAccountId,
  });

  if (userDbError) {
    await supabase.auth.admin.deleteUser(userId);
    return new Response(
      JSON.stringify({ error: `Users DB insert failed: ${userDbError.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Insertar en tabla properties
  const { error: propDbError } = await supabase.from("properties").insert({
    salesforce_account_id: property.salesforceAccountId,
    user_id: userId,
    street: property.street ?? null,
    city: property.city ?? null,
    state: property.state ?? null,
    postal_code: property.postalCode ?? null,
    housing_type: property.housingType ?? null,
    rooms: toIntOrNull(property.rooms),
    bathrooms: toIntOrNull(property.bathrooms),
    built_area: property.builtArea ?? null,
    useful_surface_area: property.usefulSurface ?? null,
    age: property.age ?? null,
    floor: toIntOrNull(property.floor),
    has_elevator: property.elevator ?? null,
    is_exterior: property.external ?? null,
    orientation: property.orientation ?? null,
    heating_type: property.heatingType ?? null,
    condition: property.condition ?? null,
    community_fee: property.communityFee ?? null,
    electronic_certificate: property.electronicCertificate ?? null,
    sales_price: property.salesPrice ?? null,
    reject_offers_below: property.rejectOffersBelow ?? null,
    ref_catastral: property.refCatastral ?? null,
    description: property.description ?? null,
    status: property.status ?? null,
    garage_space: property.garageSpace ?? null,
    registro_propiedad: property.registroPropiedad ?? null,
    owner_fee: property.ownerFee ?? null,
    buyer_fee: property.buyerFee ?? null,
  });

  if (propDbError) {
    await supabase.from("users").delete().eq("id", userId);
    await supabase.auth.admin.deleteUser(userId);
    return new Response(
      JSON.stringify({ error: `Properties DB insert failed: ${propDbError.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 4. Generar Magic Link
  const { data: magicLinkData, error: magicLinkError } =
    await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });

  let magicLink = null;
  if (magicLinkError) {
    console.error("Magic Link generation error:", magicLinkError.message);
  } else {
    magicLink = magicLinkData?.properties?.action_link ?? null;
  }

  // 5. Respuesta exitosa
  return new Response(
    JSON.stringify({
      success: true,
      user_id: userId,
      magic_link: magicLink,
      magic_link_error: magicLinkError?.message ?? null,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
});
```

---

### 2.8. Supabase — Cambios en base de datos

**Tabla `properties`:**
- Campo `age`: cambiado de `int4` a `text` (porque Salesforce envía valores como "5 a 10 anos" desde una Picklist)
- Campos `owner_fee` y `buyer_fee`: tipo `numeric`, nullable. Verificar que existen antes del despliegue.

---

## 3. Mapeo de campos Salesforce → Supabase

### Objeto Contact → Tabla `users`

| Campo Salesforce (Contact) | Campo Supabase (users) | Tipo SF | Tipo Supabase |
|---|---|---|---|
| FirstName | first_name | Text | text |
| LastName | last_name | Text | text |
| Email | email | Email | text |
| DNI__c | dni | Text | text |
| MobilePhone | phone | Phone | text |
| Id | salesforce_contact_id | ID | text |
| (del Account) AccountId | salesforce_account_id | ID | text |

### Objeto Account → Tabla `properties`

| Campo Salesforce (Account) | Clave JSON payload | Campo Supabase (properties) | Tipo SF | Tipo Supabase | Conversion |
|---|---|---|---|---|---|
| Id | salesforceAccountId | salesforce_account_id | ID | text | directo |
| BillingStreet | street | street | Text | text | directo |
| BillingPostalCode | postalCode | postal_code | Text | text | directo |
| BillingState | state | state | Text | text | directo |
| BillingCity | city | city | Text | text | directo |
| Description | description | description | Text | text | directo |
| Age__c | age | age | Picklist | text | directo (texto) |
| Bathrooms__c | bathrooms | bathrooms | Picklist | int4 | toIntOrNull() |
| Built_area__c | builtArea | built_area | Number | numeric | directo |
| Buyer_fee__c | buyerFee | buyer_fee | Percent | numeric | directo |
| Owner_fee__c | ownerFee | owner_fee | Percent | numeric | directo |
| Community_fee__c | communityFee | community_fee | Currency | numeric | directo |
| Condition_of_the_property__c | condition | condition | Picklist | text | directo |
| Electronic_certificate__c | electronicCertificate | electronic_certificate | Picklist | text | directo |
| External__c | external | is_exterior | Checkbox | bool | directo |
| Garage_space__c | garageSpace | garage_space | Picklist | text | directo |
| Heating_type__c | heatingType | heating_type | Picklist | text | directo |
| High__c | high | (no mapeado a properties) | Number | — | solo en payload |
| Housing_type__c | housingType | housing_type | Picklist | text | directo |
| It_has_an_elevator__c | elevator | has_elevator | Checkbox | bool | directo |
| Orientation__c | orientation | orientation | Picklist | text | directo |
| Ref_Catastral__c | refCatastral | ref_catastral | Text | text | directo |
| Registro_propiedad_n_mero__c | registroPropiedad | registro_propiedad | Number | numeric | directo |
| Reject_offers_below__c | rejectOffersBelow | reject_offers_below | Currency | numeric | directo |
| Rooms__c | rooms | rooms | Picklist | int4 | toIntOrNull() |
| Sales_price__c | salesPrice | sales_price | Currency | numeric | directo |
| Status__c | status | status | Picklist | text | directo |
| Useful_surface_area__c | usefulSurface | useful_surface_area | Number | numeric | directo |
| Floor__c | floor | floor | Text(15) | int4 | toIntOrNull() |

---

## 4. Flujo funcional completo

```
[Agente Herohome abre un Account en Salesforce]
    |
    v
[Pulsa boton "Enviar acceso PWA"]
    |
    v
[LWC muestra popup: "Confirmas que quieres enviar el acceso?"]
    |
    +--- [Cancelar] --> cierra popup, no hace nada
    |
    +--- [Confirmar y enviar] --> boton se deshabilita, muestra "Enviando..."
            |
            v
        [Apex: obtiene Account + Contact asociado]
            |
            v
        [Apex: construye JSON con user + property]
            |
            v
        [Apex: HTTP POST via Named Credential a Supabase Edge Function]
            |
            v
        [Edge Function: crea usuario en Supabase Auth]
            |
            v
        [Edge Function: inserta en tabla users]
            |
            v
        [Edge Function: inserta en tabla properties]
            |
            v
        [Edge Function: genera Magic Link]
            |
            v
        [Edge Function: devuelve 201 + magic_link]
            |
            +--- [Exito 201] --> Apex marca PWA_Access_Sent__c = true
            |                    LWC muestra toast verde
            |
            +--- [Error] --> Apex crea Task con detalle del error
                             LWC muestra toast rojo sticky
```

---

## 5. Prerequisitos para produccion

### 5.1. Campos custom que deben existir en produccion

**En Account:**
- Todos los campos __c listados en la query SOQL (Age__c, Bathrooms__c, etc.)
- Floor__c (Text, 15)
- Owner_fee__c (Percent)

**En Contact:**
- DNI__c (Text)
- PWA_Access_Sent__c (Checkbox)
- PWA_Access_Sent_Date__c (DateTime)

### 5.2. Named Credential + External Credential

Deben crearse en produccion con la misma configuracion que en sandbox:
- External Credential `Supabase_EC` con Authentication Protocol `Custom`
- Principal `SupabaseAdmin` con Custom Headers (`apikey` y `Authorization` con la anon key de **produccion** de Supabase)
- Named Credential `Supabase_Herohome` apuntando a la URL de Supabase de produccion
- Generate Authorization Header desactivado
- Asignar acceso al External Credential Principal en el perfil del usuario que usara el boton

### 5.3. Supabase

- Edge Function desplegada y activa
- Tabla `properties`: campo `age` tipo `text` (no `int4`)
- Tabla `properties`: campos `owner_fee` y `buyer_fee` tipo `numeric`
- Tabla `properties`: campo `floor` tipo `int4`

### 5.4. Quick Action

- Crear Quick Action tipo LWC en el objeto Account apuntando a `c:enviarAccesoPwa`
- Anadir la Quick Action al Page Layout del Account

---

## 6. Incidencias conocidas pendientes de resolver

1. **PWA_Access_Sent__c no se actualiza:** El campo checkbox en Contact no se marca como true al ejecutar el boton. Probable causa: conflicto con Person Accounts. Investigar si el update debe hacerse via Account en lugar de Contact.

2. **Campos duplicados en Account y Contact:** PWA_Access_Sent__c y PWA_Access_Sent_Date__c se crearon por error en ambos objetos. En produccion, crear solo en Contact.

3. **Edge Function slug vs nombre:** La funcion se llama `create-user-and-property` en el dashboard pero su URL es `/functions/v1/create-user`. No cambiar el slug.

---

## 7. Comandos de despliegue

### Salesforce (desde terminal con SF CLI autenticado):

```bash
# Autenticarse en produccion
sf org login web --instance-url https://login.salesforce.com --alias herohome-prod

# Desplegar LWC
sf project deploy start --source-dir force-app/main/default/lwc/enviarAccesoPwa --target-org herohome-prod

# Las clases Apex se despliegan via Change Set o directamente en Setup
```

### Supabase:

```bash
# Desplegar Edge Function
supabase functions deploy create-user --project-ref zqkvcphtqmibttgnivku
```

---

## 8. Checklist de validacion post-despliegue

- [ ] Named Credential y External Credential creados en produccion
- [ ] Anon key de produccion configurada en los Custom Headers
- [ ] External Credential Principal Access asignado al perfil del usuario
- [ ] Clases Apex desplegadas y tests en verde (4/4)
- [ ] LWC desplegado
- [ ] Quick Action creada y anadida al Page Layout del Account
- [ ] Edge Function desplegada y activa
- [ ] Campos custom verificados en Account y Contact
- [ ] Tabla properties: age = text, owner_fee = numeric, buyer_fee = numeric, floor = int4
- [ ] Test end-to-end: pulsar boton en un Account de prueba, verificar creacion en Supabase
- [ ] Verificar que el Magic Link llega al email del cliente
- [ ] Verificar que el Magic Link funciona (el usuario puede acceder a la PWA)

// Plantillas de email para confirmación / cancelación de visita (PC).
// Branding alineado con welcome.ts (Inter, #5B5CFF, #0A0E17, #F8FAFC).

import { emailShell, OPEN_APP_CTA } from "./shell.ts"

interface VisitEmailParams {
  visitorName: string
  propertyAddress: string
  dateTime: string
}

export function visitConfirmationHtml(params: VisitEmailParams): string {
  return emailShell({
    accentColor: "#16A34A",
    heading: `¡Tu visita está confirmada! ✅`,
    intro: `Hola ${params.visitorName}, hemos confirmado tu visita. Aquí tienes los detalles:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Fecha y hora", value: params.dateTime },
    ],
    closing:
      "Si necesitas cambiar o cancelar la visita, respóndenos por WhatsApp y te ayudamos enseguida. ¡Te esperamos!",
  })
}

export function visitCancellationHtml(params: VisitEmailParams): string {
  return emailShell({
    accentColor: "#DC2626",
    heading: `Tu visita ha sido cancelada`,
    intro: `Hola ${params.visitorName}, lamentamos informarte de que esta visita ha sido cancelada:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Fecha y hora", value: params.dateTime },
    ],
    closing:
      "Si quieres, escríbenos por WhatsApp y te ayudamos a reagendarla en otro horario que te venga mejor.",
  })
}

// Email dirigido al PROPIETARIO (CV) cuando un comprador cancela una visita
// que estaba confirmada.
export function ownerVisitCanceledByVisitorHtml(params: {
  ownerName?: string
  visitorName: string
  propertyAddress: string
  dateTime: string
}): string {
  const saludo = params.ownerName ? `Hola ${params.ownerName}, ` : "Hola, "
  return emailShell({
    accentColor: "#DC2626",
    heading: "Un comprador ha cancelado su visita",
    intro: `${saludo}te informamos de que un comprador ha cancelado una visita que tenías confirmada en tu vivienda:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Visita cancelada", value: params.dateTime },
      { label: "Comprador", value: params.visitorName },
    ],
    closing: "Puedes consultar el estado de tus visitas en tu panel de Herohome.",
    cta: OPEN_APP_CTA,
  })
}

// Recordatorio (el día antes) — dirigido al COMPRADOR (PC).
export function visitReminderPcHtml(params: {
  visitorName: string
  propertyAddress: string
  dateTime: string
}): string {
  return emailShell({
    accentColor: "#5B5CFF",
    heading: "Recordatorio de tu visita 📅",
    intro: `Hola ${params.visitorName}, te recordamos que mañana tienes una visita:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Fecha y hora", value: params.dateTime },
    ],
    closing: "¡Te esperamos! Si necesitas cambiarla o cancelarla, respóndenos por WhatsApp.",
  })
}

// Recordatorio (el día antes) — dirigido al PROPIETARIO (CV).
export function visitReminderCvHtml(params: {
  ownerName?: string
  visitorName: string
  propertyAddress: string
  dateTime: string
}): string {
  const saludo = params.ownerName ? `Hola ${params.ownerName}, ` : "Hola, "
  return emailShell({
    accentColor: "#5B5CFF",
    heading: "Recordatorio: visita mañana en tu vivienda 📅",
    intro: `${saludo}te recordamos que mañana tienes una visita programada en tu vivienda:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Fecha y hora", value: params.dateTime },
      { label: "Visitante", value: params.visitorName || "—" },
    ],
    closing: "Puedes ver el detalle en tu panel de Herohome.",
    cta: OPEN_APP_CTA,
  })
}

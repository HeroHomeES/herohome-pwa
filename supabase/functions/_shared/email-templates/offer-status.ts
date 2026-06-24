// Plantillas de email para decisiones sobre ofertas.
// Al PC: aceptada / rechazada / contraoferta. Al equipo: alerta interina
// (sustituye al dashboard mientras B8 está aplazado).

import { emailShell } from "./shell.ts"

function formatEuros(amount: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount)
}

// ── Al COMPRADOR (PC) ────────────────────────────────────────────────────────

export function offerAcceptedPcHtml(params: {
  buyerName: string
  propertyAddress: string
  amount: number
}): string {
  return emailShell({
    accentColor: "#16A34A",
    heading: "¡Tu oferta ha sido aceptada! 🎉",
    intro: `Hola ${params.buyerName}, ¡buenas noticias! El propietario ha aceptado tu oferta:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Oferta aceptada", value: formatEuros(params.amount) },
    ],
    closing:
      "Nos pondremos en contacto contigo muy pronto para los siguientes pasos (contrato de arras y firma digital).",
  })
}

export function offerDeniedPcHtml(params: {
  buyerName: string
  propertyAddress: string
}): string {
  return emailShell({
    accentColor: "#DC2626",
    heading: "Actualización sobre tu oferta",
    intro: `Hola ${params.buyerName}, el propietario no ha aceptado tu oferta por esta vivienda:`,
    detailRows: [{ label: "Vivienda", value: params.propertyAddress }],
    closing:
      "Si quieres, puedes proponer una nueva oferta escribiéndonos por WhatsApp. Estaremos encantados de ayudarte.",
  })
}

export function offerCounterPcHtml(params: {
  buyerName: string
  propertyAddress: string
  amount: number
}): string {
  return emailShell({
    accentColor: "#5B5CFF",
    heading: "Has recibido una contraoferta",
    intro: `Hola ${params.buyerName}, el propietario ha respondido a tu oferta con una contraoferta:`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Contraoferta del propietario", value: formatEuros(params.amount) },
    ],
    closing:
      "Revisa tu WhatsApp para aceptarla, rechazarla o proponer una nueva oferta. Si lo prefieres, también puedes escribirnos a hola@herohome.es.",
  })
}

// ── Al EQUIPO Herohome (interim del dashboard, B8 aplazado) ──────────────────

export function teamOfferAlertHtml(params: {
  eventLabel: string
  propertyAddress: string
  amount: number
  buyerName: string | null
  buyerPhone: string | null
  buyerEmail: string | null
  buyerDni: string | null
  note?: string
}): string {
  const detailRows = [
    { label: "Evento", value: params.eventLabel },
    { label: "Vivienda", value: params.propertyAddress },
    { label: "Importe", value: formatEuros(params.amount) },
    { label: "Comprador", value: params.buyerName || "—" },
    { label: "Teléfono", value: params.buyerPhone || "—" },
    { label: "Email", value: params.buyerEmail || "—" },
    { label: "DNI", value: params.buyerDni || "—" },
  ]
  if (params.note) detailRows.push({ label: "Nota", value: params.note })
  return emailShell({
    accentColor: "#5B5CFF",
    heading: `Ofertas — ${params.eventLabel}`,
    intro: "Se ha registrado un movimiento de oferta. Datos para gestión:",
    detailRows,
    closing:
      "Aviso interno automático. Si la oferta está aceptada, contacta con el comprador para el contrato de arras.",
  })
}

// ── Al PROPIETARIO (CV): respuesta del comprador a una contraoferta ──────────

export function offerCvBuyerAcceptedHtml(params: {
  ownerName?: string
  propertyAddress: string
  amount: number
}): string {
  const saludo = params.ownerName ? `Hola ${params.ownerName}, ` : "Hola, "
  return emailShell({
    accentColor: "#16A34A",
    heading: "El comprador ha aceptado tu contraoferta 🤝",
    intro: `${saludo}buenas noticias: el comprador ha aceptado tu contraoferta.`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Importe acordado", value: formatEuros(params.amount) },
    ],
    closing:
      "Nos pondremos en contacto contigo y con el comprador para los siguientes pasos (contrato de arras y firma).",
  })
}

export function offerCvBuyerRejectedHtml(params: {
  ownerName?: string
  propertyAddress: string
}): string {
  const saludo = params.ownerName ? `Hola ${params.ownerName}, ` : "Hola, "
  return emailShell({
    accentColor: "#DC2626",
    heading: "El comprador ha rechazado tu contraoferta",
    intro: `${saludo}te informamos de que el comprador ha rechazado tu contraoferta y ha cerrado la negociación por esta vivienda.`,
    detailRows: [{ label: "Vivienda", value: params.propertyAddress }],
    closing: "Puedes consultar el estado de tus ofertas en tu panel de Herohome.",
  })
}

export function offerCvNewBuyerOfferHtml(params: {
  ownerName?: string
  propertyAddress: string
  amount: number
}): string {
  const saludo = params.ownerName ? `Hola ${params.ownerName}, ` : "Hola, "
  return emailShell({
    accentColor: "#5B5CFF",
    heading: "El comprador ha hecho una nueva oferta",
    intro: `${saludo}el comprador ha respondido a tu contraoferta con una nueva oferta.`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Nueva oferta del comprador", value: formatEuros(params.amount) },
    ],
    closing: "Entra en tu panel de Herohome para aceptarla, rechazarla o hacer una nueva contraoferta.",
  })
}

export function offerCvNewOfferHtml(params: {
  ownerName?: string
  propertyAddress: string
  amount: number
}): string {
  const saludo = params.ownerName ? `Hola ${params.ownerName}, ` : "Hola, "
  return emailShell({
    accentColor: "#5B5CFF",
    heading: "Has recibido una nueva oferta 💰",
    intro: `${saludo}un comprador ha hecho una oferta por tu vivienda.`,
    detailRows: [
      { label: "Vivienda", value: params.propertyAddress },
      { label: "Oferta del comprador", value: formatEuros(params.amount) },
    ],
    closing: "Entra en tu panel de Herohome para aceptarla, rechazarla o hacer una contraoferta.",
  })
}

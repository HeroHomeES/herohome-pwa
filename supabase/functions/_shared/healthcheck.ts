// Dead-man's-switch de crons (Healthchecks.io): al terminar cada ejecución del
// cron se hace un GET a la URL del check; si un día el cron NO corre (o falla),
// Healthchecks avisa por email al equipo. Complementa a alertTeam: alertTeam
// detecta "corrió y falló", esto detecta "no llegó a correr".
//
// Las URLs viven en la tabla app_config (editable en el Table Editor):
//   healthcheck_generate_slots · healthcheck_visit_reminders ·
//   healthcheck_post_visit_followup (las de los crons SQL van en setup-crons.sql).
//
// BEST-EFFORT y FAIL-OPEN: sin tabla, sin fila o con valor vacío no se hace
// nada y nunca se lanza un error (el cron no debe romperse por el monitor).

export async function pingHealthcheck(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  configKey: string,
  ok = true
): Promise<void> {
  try {
    const { data } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", configKey)
      .maybeSingle()
    const url = typeof data?.value === "string" ? data.value.trim() : ""
    if (!url) return
    // Healthchecks.io: GET a la URL = "estoy vivo"; con /fail = "corrí pero fallé".
    await fetch(ok ? url : `${url}/fail`, { method: "GET" })
  } catch (_e) {
    // best-effort: el monitor nunca rompe el cron.
  }
}

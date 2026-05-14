#!/usr/bin/env bash
# Tests de integración para get-available-slots y request-visit-slot.
#
# Variables requeridas (en entorno o .env):
#   VITE_SUPABASE_URL        — URL del proyecto Supabase
#   HEROHOME_API_KEY         — API key para x-api-key (secret de Supabase, no está en .env)
#   SUPABASE_SERVICE_ROLE_KEY — Para limpiar el slot de test al finalizar
#
# Variables opcionales:
#   TEST_PROPERTY_ID — property_id con slots Available (default: propiedad de desarrollo)
#
# Uso:
#   HEROHOME_API_KEY=<key> SUPABASE_SERVICE_ROLE_KEY=<key> ./scripts/test-visit-slots.sh

set -euo pipefail

# ── Carga .env si existe ──────────────────────────────────────────────────────
if [ -f "$(dirname "$0")/../.env" ]; then
  # shellcheck disable=SC1091
  set -a
  source "$(dirname "$0")/../.env"
  set +a
fi

BASE_URL="${VITE_SUPABASE_URL:-}"
API_KEY="${HEROHOME_API_KEY:-}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
PROP_ID="${TEST_PROPERTY_ID:-b203eef5-1d46-44ce-990e-d48e5f7b001a}"

# ── Validar variables requeridas ──────────────────────────────────────────────
if [ -z "$BASE_URL" ]; then
  echo "ERROR: VITE_SUPABASE_URL no está definida" >&2; exit 1
fi
if [ -z "$API_KEY" ]; then
  echo "ERROR: HEROHOME_API_KEY no está definida" >&2; exit 1
fi
if [ -z "$SERVICE_KEY" ]; then
  echo "ERROR: SUPABASE_SERVICE_ROLE_KEY no está definida (necesaria para limpiar el slot de test)" >&2; exit 1
fi

SLOTS_URL="${BASE_URL}/functions/v1/get-available-slots"
REQUEST_URL="${BASE_URL}/functions/v1/request-visit-slot"
REST_URL="${BASE_URL}/rest/v1"

PASS=0
FAIL=0
BOOKED_SLOT_ID=""

# ── Helpers ───────────────────────────────────────────────────────────────────
ok()   { echo " [OK]   $1"; PASS=$((PASS + 1)); }
fail() { echo " [FAIL] $1"; FAIL=$((FAIL + 1)); }

check_field() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then ok "$label"; else fail "$label (esperado: '$expected', obtenido: '$actual')"; fi
}

json_get() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print($2)" 2>/dev/null || echo ""
}

# ── Cabecera ──────────────────────────────────────────────────────────────────
echo "=================================================="
echo " Tests: get-available-slots + request-visit-slot"
echo "=================================================="
echo " URL base:    ${BASE_URL}"
echo " property_id: ${PROP_ID}"
echo "--------------------------------------------------"
echo ""

# ── TEST 1: Sin API key → 401 ─────────────────────────────────────────────────
echo "[ 1/8 ] get-available-slots sin x-api-key → 401"
R=$(curl -s -o /dev/null -w "%{http_code}" "${SLOTS_URL}?property_id=${PROP_ID}")
check_field "HTTP 401" "401" "$R"
echo ""

# ── TEST 2: API key incorrecta → 401 ──────────────────────────────────────────
echo "[ 2/8 ] get-available-slots con API key incorrecta → 401"
R=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: clave-invalida" "${SLOTS_URL}?property_id=${PROP_ID}")
check_field "HTTP 401" "401" "$R"
echo ""

# ── TEST 3: property_id con formato inválido → 400 ────────────────────────────
echo "[ 3/8 ] get-available-slots con property_id no-UUID → 400"
BODY=$(curl -s -H "x-api-key: ${API_KEY}" "${SLOTS_URL}?property_id=esto-no-es-un-uuid")
ERR=$(echo "$BODY" | json_get - "'error' in d and 'Invalid' in d['error'] and 'true' or 'false'")
check_field "error Invalid property_id format" "true" "$ERR"
echo ""

# ── TEST 4: property_id inexistente → 404 ────────────────────────────────────
echo "[ 4/8 ] get-available-slots con property_id inexistente → 404"
R=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: ${API_KEY}" \
  "${SLOTS_URL}?property_id=00000000-0000-0000-0000-000000000000")
check_field "HTTP 404" "404" "$R"
echo ""

# ── TEST 5: propiedad real → 200 con slots agrupados ─────────────────────────
echo "[ 5/8 ] get-available-slots con propiedad real → 200"
SLOTS_RESP=$(curl -s -H "x-api-key: ${API_KEY}" "${SLOTS_URL}?property_id=${PROP_ID}&days_ahead=14")
HTTP_PROP_ID=$(echo "$SLOTS_RESP" | json_get - "d.get('property_id','')")
TOTAL=$(echo "$SLOTS_RESP"       | json_get - "d.get('total_slots',-1)")
SLOTS_COUNT=$(echo "$SLOTS_RESP" | json_get - "len(d.get('slots',[]))")

check_field "property_id en respuesta"   "$PROP_ID" "$HTTP_PROP_ID"
check_field "total_slots >= 0"           "true" "$([ "${TOTAL:-0}" -ge 0 ] 2>/dev/null && echo true || echo false)"
check_field "slots es array"             "true" "$([ "${SLOTS_COUNT:-0}" -ge 0 ] 2>/dev/null && echo true || echo false)"

# Verificar estructura del primer día si hay slots
if [ "${SLOTS_COUNT:-0}" -gt 0 ]; then
  FIRST_DATE=$(echo "$SLOTS_RESP"       | json_get - "d['slots'][0]['date']")
  FIRST_DOW=$(echo "$SLOTS_RESP"        | json_get - "d['slots'][0]['day_of_week']")
  FIRST_SLOT_ID=$(echo "$SLOTS_RESP"    | json_get - "d['slots'][0]['times'][0]['slot_id']")
  FIRST_DISPLAY=$(echo "$SLOTS_RESP"    | json_get - "d['slots'][0]['times'][0]['display']")
  FIRST_OFFSET=$(echo "$SLOTS_RESP"     | json_get - "d['slots'][0]['times'][0]['start_time'][-6:]")

  check_field "date en formato YYYY-MM-DD" "true" \
    "$(echo "$FIRST_DATE" | python3 -c "import sys,re; print('true' if re.match(r'^\d{4}-\d{2}-\d{2}$',sys.stdin.read().strip()) else 'false')" 2>/dev/null || echo false)"
  check_field "day_of_week en español"     "true" \
    "$(python3 -c "print('true' if '${FIRST_DOW}' in ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'] else 'false')" 2>/dev/null || echo false)"
  check_field "display tiene formato HH:MM - HH:MM" "true" \
    "$(echo "$FIRST_DISPLAY" | python3 -c "import sys,re; print('true' if re.match(r'^\d{2}:\d{2} - \d{2}:\d{2}$',sys.stdin.read().strip()) else 'false')" 2>/dev/null || echo false)"
  check_field "start_time con offset Madrid (+01:00 o +02:00)" "true" \
    "$(python3 -c "print('true' if '${FIRST_OFFSET}' in ['+01:00','+02:00'] else 'false')" 2>/dev/null || echo false)"

  # Guardar slot_id para los tests siguientes
  BOOKED_SLOT_ID="$FIRST_SLOT_ID"
fi
echo ""

# ── TEST 6: request-visit-slot sin consentimiento → 400 ──────────────────────
echo "[ 6/8 ] request-visit-slot con consent_given=false → 400"
if [ -n "$BOOKED_SLOT_ID" ]; then
  BODY=$(curl -s -X POST \
    -H "x-api-key: ${API_KEY}" -H "Content-Type: application/json" \
    -d "{\"slot_id\":\"${BOOKED_SLOT_ID}\",\"visitor_name\":\"Test\",\"visitor_last_name\":\"Visitor\",\"visitor_phone\":\"+34600000000\",\"consent_given\":false}" \
    "$REQUEST_URL")
  ERR=$(echo "$BODY" | json_get - "'RGPD' in d.get('error','') and 'true' or 'false'")
  check_field "error menciona RGPD" "true" "$ERR"
else
  echo " [SKIP] No hay slots disponibles para probar"
fi
echo ""

# ── TEST 7: request-visit-slot en slot disponible → 201 ──────────────────────
echo "[ 7/8 ] request-visit-slot en slot disponible → 201"
if [ -n "$BOOKED_SLOT_ID" ]; then
  TMPFILE=$(mktemp)
  HTTP_CODE=$(curl -s -w "%{http_code}" -o "$TMPFILE" -X POST \
    -H "x-api-key: ${API_KEY}" -H "Content-Type: application/json" \
    -d "{
      \"slot_id\": \"${BOOKED_SLOT_ID}\",
      \"visitor_name\": \"Test\",
      \"visitor_last_name\": \"Visitante\",
      \"visitor_phone\": \"+34600000099\",
      \"visitor_email\": \"test@herohome-test.es\",
      \"consent_given\": true
    }" "$REQUEST_URL")
  JSON_BODY=$(cat "$TMPFILE")
  rm -f "$TMPFILE"

  check_field "HTTP 201"        "201" "$HTTP_CODE"
  SUCCESS=$(echo "$JSON_BODY"   | json_get - "str(d.get('success',False)).lower()")
  STATUS=$(echo "$JSON_BODY"    | json_get - "d.get('status','')")
  check_field "success: true"   "true" "$SUCCESS"
  check_field "status: Pending to confirm" "Pending to confirm" "$STATUS"
else
  echo " [SKIP] No hay slots disponibles para probar"
fi
echo ""

# ── TEST 8: mismo slot otra vez → 409 (race condition guard) ─────────────────
echo "[ 8/8 ] request-visit-slot en slot ya reservado → 409"
if [ -n "$BOOKED_SLOT_ID" ]; then
  R=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "x-api-key: ${API_KEY}" -H "Content-Type: application/json" \
    -d "{\"slot_id\":\"${BOOKED_SLOT_ID}\",\"visitor_name\":\"Otro\",\"visitor_last_name\":\"Visitante\",\"visitor_phone\":\"+34600000001\",\"consent_given\":true}" \
    "$REQUEST_URL")
  check_field "HTTP 409" "409" "$R"
else
  echo " [SKIP] No hay slots disponibles para probar"
fi
echo ""

# ── Limpieza: resetear slot de test a Available ───────────────────────────────
if [ -n "$BOOKED_SLOT_ID" ]; then
  echo "--------------------------------------------------"
  echo " Limpiando slot de test..."
  CLEAN=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"Available\",\"visitor_name\":null,\"visitor_last_name\":null,\"visitor_phone\":null,\"visitor_email\":null,\"visitor_dni\":null,\"consent_given\":false,\"consent_at\":null}" \
    "${REST_URL}/visit_slots?id=eq.${BOOKED_SLOT_ID}")
  if [ "$CLEAN" = "204" ]; then
    echo " [OK]   Slot ${BOOKED_SLOT_ID} restaurado a Available"
  else
    echo " [WARN] No se pudo limpiar el slot (HTTP ${CLEAN}) — hazlo manualmente si es necesario"
  fi
fi

# ── Resumen ───────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
echo " Resultado: ${PASS} OK  |  ${FAIL} FAIL"
echo "=================================================="

[ "$FAIL" -eq 0 ] || exit 1

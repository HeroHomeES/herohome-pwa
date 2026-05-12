#!/usr/bin/env bash
set -euo pipefail

# Carga variables de entorno desde .env si existe
if [ -f "$(dirname "$0")/../.env" ]; then
  # shellcheck disable=SC1091
  set -a
  source "$(dirname "$0")/../.env"
  set +a
fi

# Variables requeridas
SUPABASE_URL="${VITE_SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"

if [ -z "$SUPABASE_URL" ]; then
  echo "ERROR: VITE_SUPABASE_URL no está definida (ni en entorno ni en .env)" >&2
  exit 1
fi

if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "ERROR: VITE_SUPABASE_ANON_KEY no está definida (ni en entorno ni en .env)" >&2
  exit 1
fi

# Datos de prueba
TIMESTAMP=$(date +%s)
TEST_EMAIL="${TEST_EMAIL:-test-${TIMESTAMP}@herohome-test.es}"
SF_ACCOUNT_ID="001TEST${TIMESTAMP}"

echo "=================================================="
echo " Test: create-user-and-property + welcome email"
echo "=================================================="
echo " URL:    ${SUPABASE_URL}/functions/v1/create-user-and-property"
echo " Email:  ${TEST_EMAIL}"
echo " SF ID:  ${SF_ACCOUNT_ID}"
echo "--------------------------------------------------"

RESPONSE=$(curl --silent --show-error \
  --request POST \
  --url "${SUPABASE_URL}/functions/v1/create-user-and-property" \
  --header "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  --header "Content-Type: application/json" \
  --data "{
    \"salesforceAccountId\": \"${SF_ACCOUNT_ID}\",
    \"user\": {
      \"email\": \"${TEST_EMAIL}\",
      \"firstName\": \"Ana\",
      \"lastName\": \"García\",
      \"phone\": \"+34600000001\"
    },
    \"property\": {
      \"street\": \"Calle Gran Vía 1\",
      \"city\": \"Madrid\",
      \"state\": \"Madrid\",
      \"postalCode\": \"28013\",
      \"housingType\": \"Piso\",
      \"rooms\": 3,
      \"bathrooms\": 2,
      \"builtArea\": 90,
      \"salesPrice\": 350000,
      \"status\": \"On Sale\"
    }
  }")

echo ""
echo "Respuesta:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

# Verificaciones
SUCCESS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('success',False)).lower())" 2>/dev/null || echo "false")
EMAIL_SENT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('email_sent',False)).lower())" 2>/dev/null || echo "false")
EMAIL_ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('email_error') or '')" 2>/dev/null || echo "")

echo "=================================================="
if [ "$SUCCESS" = "true" ]; then
  echo " [OK] success: true"
else
  echo " [FAIL] success no es true"
fi

if [ "$EMAIL_SENT" = "true" ]; then
  echo " [OK] email_sent: true"
elif [ -n "$EMAIL_ERROR" ]; then
  echo " [WARN] email_sent: false — error: ${EMAIL_ERROR}"
else
  echo " [WARN] email_sent: false (sin detalle de error)"
fi
echo "=================================================="

if [ "$SUCCESS" != "true" ]; then
  exit 1
fi

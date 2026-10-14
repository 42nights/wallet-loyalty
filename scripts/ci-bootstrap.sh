#!/usr/bin/env bash
# Bring a machine (a fresh laptop, the spare Mac mini, or a CI runner) to the
# state the test suites expect: local Supabase running with schema.sql applied,
# the pass-assets bucket, and a LOCAL-ONLY .env.local with a throwaway signing
# chain. Idempotent — safe to re-run. It never points at production: every URL
# it writes is 127.0.0.1, and an existing .env.local is left untouched.
#
#   bash scripts/ci-bootstrap.sh && npm run ci
set -euo pipefail
cd "$(dirname "$0")/.."

# Services the app and tests don't use are skipped to start faster.
supabase status >/dev/null 2>&1 ||
  supabase start -x realtime,edge-runtime,logflare,vector,imgproxy,mailpit,supavisor,studio

# psql if installed (CI runners have it); otherwise the one inside the DB container.
sql() {
  if command -v psql >/dev/null 2>&1; then
    PGOPTIONS='--client-min-messages=warning' \
      psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -q
  else
    local project
    project=$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)
    docker exec -i -e PGOPTIONS='--client-min-messages=warning' "supabase_db_${project}" \
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
  fi
}

sql < supabase/schema.sql
sql <<'SQL'
insert into storage.buckets (id, name, public) values ('pass-assets', 'pass-assets', false)
  on conflict do nothing;
notify pgrst, 'reload schema';
SQL
echo "✓ schema applied, pass-assets bucket present"

if [ -f .env.local ]; then
  echo "✓ .env.local exists — left as is"
  exit 0
fi

# A throwaway WWDR + signer chain: passes build and sign, but are not Apple-
# signed, so they never install on a real iPhone. That is the point.
certs=$(mktemp -d)
trap 'rm -rf "$certs"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$certs/ca.key" -out "$certs/wwdr.pem" \
  -days 3650 -subj "/CN=LOCAL TEST WWDR - NOT APPLE" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout "$certs/signer.key" -out "$certs/signer.csr" \
  -subj "/CN=Pass Type ID: pass.com.42nights.loyalty (LOCAL TEST)" 2>/dev/null
openssl x509 -req -in "$certs/signer.csr" -CA "$certs/wwdr.pem" -CAkey "$certs/ca.key" \
  -CAcreateserial -out "$certs/signer.pem" -days 3650 2>/dev/null

b64() { base64 < "$1" | tr -d '\n'; }
service_key=$(supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')
[ -n "$service_key" ] || { echo "could not read SERVICE_ROLE_KEY from supabase status" >&2; exit 1; }

cat > .env.local <<EOF
# LOCAL ONLY — written by scripts/ci-bootstrap.sh. Points at the local Supabase
# stack and a self-signed test signing chain. Never put production values here.
PUBLIC_BASE_URL=http://localhost:3100
SESSION_SECRET=$(openssl rand -hex 32)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=${service_key}
PASS_TYPE_ID=pass.com.42nights.loyalty
APPLE_TEAM_ID=LOCALTEST1
PASS_ORG_NAME=42nights
APPLE_WWDR_PEM=$(b64 "$certs/wwdr.pem")
PASS_SIGNER_CERT_PEM=$(b64 "$certs/signer.pem")
PASS_SIGNER_KEY_PEM=$(b64 "$certs/signer.key")
PASS_SIGNER_KEY_PASSPHRASE=
APNS_HOST=https://127.0.0.1:59999
ADMIN_PASSWORD=local-admin-pw
EOF
echo "✓ wrote LOCAL-ONLY .env.local"

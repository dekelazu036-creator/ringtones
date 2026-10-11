#!/bin/zsh
# Creates an auto-confirmed test user in the STAGING project and adds it to the cloud-library beta list.
# Run it yourself in a terminal:  zsh supabase/tests/staging/create_test_user.sh
# - The password is typed hidden and goes only to Supabase Auth (never printed, never in argv or a file).
# - The secret key is fetched by the Supabase CLI into a shell variable and never printed.
# - Staging only: refuses unless the CLI is linked to snipring-staging.
set -u
STAGING=kavomvsvufqnqjepbevs
cd "$(dirname "$0")/../../.." || exit 1

linked=$(cat supabase/.temp/project-ref 2>/dev/null)
if [[ "$linked" != "$STAGING" ]]; then echo "REFUSING: the CLI is not linked to staging ($STAGING)."; exit 1; fi

read -r "EMAIL?Email for the new test user (e.g. you+c@gmail.com): "
if [[ ! "$EMAIL" =~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' ]]; then echo "Not a valid email."; exit 1; fi
read -rs "PASSWORD?Password (hidden): "; echo
read -rs "PASSWORD2?Same password again (hidden): "; echo
if [[ "$PASSWORD" != "$PASSWORD2" ]]; then echo "Passwords differ. Nothing was created."; exit 1; fi
if (( ${#PASSWORD} < 8 )); then echo "Use at least 8 characters. Nothing was created."; exit 1; fi
unset PASSWORD2

# secret key for the admin API: prefer the new sb_secret key, fall back to the legacy service_role JWT
keys=$(supabase projects api-keys --project-ref "$STAGING" --reveal --output-format json 2>/dev/null \
       || supabase projects api-keys --project-ref "$STAGING" --reveal -o json 2>/dev/null)
SECRET=$(print -r -- "$keys" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    try { const a = JSON.parse(s); const list = Array.isArray(a) ? a : (a.keys || []);
      const k = list.find(x => /^sb_secret_/.test(x.api_key || "")) || list.find(x => x.name === "service_role");
      process.stdout.write(k ? k.api_key : ""); } catch { process.stdout.write(""); } });')
unset keys
if [[ -z "$SECRET" ]]; then
  echo "Could not read the secret key with the CLI."
  echo "Dashboard → Project Settings → API Keys → Secret keys → copy, then paste it here."
  read -rs "SECRET?Secret key (hidden): "; echo
fi

export SB_URL="https://$STAGING.supabase.co" SECRET EMAIL PASSWORD
UID_NEW=$(node -e '
  const { SB_URL, SECRET, EMAIL, PASSWORD } = process.env;
  const h = { apikey: SECRET, "content-type": "application/json" };
  if (SECRET.split(".").length === 3) h.authorization = "Bearer " + SECRET;   // legacy JWT key
  fetch(SB_URL + "/auth/v1/admin/users", { method: "POST", headers: h,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }) })
  .then(async r => { const j = await r.json().catch(() => ({}));
    if (r.ok && j.id) { process.stdout.write(j.id); return; }
    if (r.status === 422 && /exist|registered/i.test(JSON.stringify(j))) { process.stdout.write("EXISTS"); return; }
    process.stderr.write("Auth refused: HTTP " + r.status + " " + (j.msg || j.message || j.error_code || "") + "\n"); process.exit(1); })
  .catch(e => { process.stderr.write("Network error: " + e.message + "\n"); process.exit(1); });') || { unset PASSWORD SECRET; exit 1; }
unset PASSWORD SECRET

if [[ "$UID_NEW" == "EXISTS" ]]; then
  echo "A user with that email already exists; using it."
  UID_NEW=$(supabase db query --linked -o csv "select id from auth.users where email = lower('$EMAIL')" 2>/dev/null | tail -1)
fi
if [[ ! "$UID_NEW" =~ '^[0-9a-f-]{36}$' ]]; then echo "Could not determine the user id."; exit 1; fi

supabase db query --linked "insert into private.cloud_access (user_id) values ('$UID_NEW') on conflict do nothing" >/dev/null 2>&1 \
  && echo "Created/confirmed test user $EMAIL ($UID_NEW) and added it to the beta list." \
  || { echo "User exists ($UID_NEW) but adding it to the beta list failed."; exit 1; }

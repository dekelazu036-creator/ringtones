#!/bin/zsh
# PRODUCTION alerting setup. OWNER RUNS THIS (after running the health SQL in the SQL Editor).
# Generates HEALTH_SECRET, stores it as the production function secret AND as the GitHub Actions secret
# (repository dekelazu036-creator/ringtones), and deploys library-health. The secret is never printed.
set -u
PROD=gtjtvfogqrnuiducvoqm
REPO=dekelazu036-creator/ringtones
cd "$(dirname "$0")/../.." || exit 1
echo "This deploys library-health to PRODUCTION ($PROD) and sets HEALTH_SECRET there and in GitHub ($REPO)."
read -r "OK?Type the word production to continue: "
[[ "$OK" == "production" ]] || { echo "Cancelled."; exit 1; }
fail() { unset SECRET; echo "FAILED: $1"; exit 1; }
SECRET=$(openssl rand -hex 32) || fail openssl
TMP=$(mktemp); chmod 600 "$TMP"; print -r -- "HEALTH_SECRET=$SECRET" > "$TMP"
supabase secrets set --project-ref "$PROD" --env-file "$TMP" >/dev/null 2>&1; code=$?
rm -f "$TMP"; (( code == 0 )) || fail "supabase secrets set"
echo "   function secret ok"
print -rn -- "$SECRET" | gh secret set HEALTH_SECRET --repo "$REPO" >/dev/null 2>&1 || fail "gh secret set"
unset SECRET
echo "   GitHub secret ok"
supabase functions deploy library-health --project-ref "$PROD" --use-api --no-verify-jwt >/dev/null 2>&1 || fail "deploy library-health"
echo "   library-health deployed"
gh workflow run health.yml --repo "$REPO" >/dev/null 2>&1 && echo "   first health check started on GitHub"
echo "DONE. Tell Claude: health done."

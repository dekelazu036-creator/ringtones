#!/bin/zsh
# PRODUCTION media backup to Cloudflare R2. OWNER RUNS THIS.
# Asks for the bucket-scoped API token keys (hidden), PROVES they work on the EU endpoint with a real write +
# delete of a tiny test object (stops if the bucket is not in the EU jurisdiction), then stores them as production function secrets and redeploys
# library-janitor. The keys are never printed and never written to disk except a mode-600 temp file, removed by
# the cleanup below on success, failure, Ctrl+C, terminal close (HUP) or kill (TERM).
set -u
PROD=gtjtvfogqrnuiducvoqm
BUCKET=snipring-media-backup
cd "$(dirname "$0")/../.." || exit 1

TMP=''
cleanup() {
  [[ -n "$TMP" && -e "$TMP" ]] && rm -f -- "$TMP"
  TMP=''; unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY 2>/dev/null
}
trap cleanup EXIT                                   # normal end and every `exit`
trap 'cleanup; exit 130' INT                        # Ctrl+C
trap 'cleanup; exit 129' HUP                        # terminal closed
trap 'cleanup; exit 143' TERM                       # kill
umask 077                                           # anything created from here on is owner-only

echo "Media backup setup for PRODUCTION ($PROD), R2 bucket $BUCKET."
ACCOUNT=0eb78d7eac7eabc99d8e02dd80c2b0b3          # Cloudflare account id (public; part of the R2 endpoint)
read -rs "R2_ACCESS_KEY_ID?Access Key ID (hidden): "; echo
read -rs "R2_SECRET_ACCESS_KEY?Secret Access Key (hidden): "; echo
[[ -n "$R2_ACCESS_KEY_ID" && -n "$R2_SECRET_ACCESS_KEY" ]] || { echo "Both keys are needed."; exit 1; }
export R2_BUCKET=$BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY

# the bucket must be in the EU jurisdiction (privacy policy): try the EU endpoint first, the global one only to explain
r2test() {
  R2_ENDPOINT=$1 node --input-type=module -e '
    import { r2Client } from "./supabase/functions/_shared/r2.ts";
    const c = r2Client({ endpoint: process.env.R2_ENDPOINT, bucket: process.env.R2_BUCKET,
      accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY });
    const key = "_selftest/" + Date.now() + ".mp3";
    const put = await c.put(key, new Uint8Array([73, 68, 51]));
    if (put !== "ok") { console.log("   " + put.error); process.exit(1); }
    const del = await c.del(key); if (del !== "ok") { console.log("   delete: " + del.error); process.exit(1); }
    const list = await c.list(); if ("error" in list) { console.log("   list: " + list.error); process.exit(1); }'
}
echo "== testing write + delete on the EU endpoint"
if r2test "https://$ACCOUNT.eu.r2.cloudflarestorage.com"; then
  R2_ENDPOINT="https://$ACCOUNT.eu.r2.cloudflarestorage.com"; echo "   OK: the bucket is in the EU, write/delete/list work"
else
  if r2test "https://$ACCOUNT.r2.cloudflarestorage.com" >/dev/null 2>&1; then
    echo "   STOP: the keys work, but the bucket is NOT in the EU jurisdiction."
    echo "   Delete the empty bucket $BUCKET in Cloudflare and create it again with: Specify jurisdiction -> European Union (EU)."
  else
    echo "   STOP: the keys do not work for $BUCKET (wrong keys, or the token is not allowed on this bucket)."
  fi
  unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; exit 1
fi
export R2_ENDPOINT

read -r "OK?Store these as PRODUCTION secrets and turn the backup on? Type the word production: "
[[ "$OK" == "production" ]] || { unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; echo "Cancelled. Nothing stored."; exit 1; }
TMP=$(mktemp "${TMPDIR:-/tmp}/snipring-r2.XXXXXX") || { echo "FAILED: temp file"; exit 1; }
chmod 600 "$TMP"
{ print -r -- "R2_ENDPOINT=$R2_ENDPOINT"; print -r -- "R2_BUCKET=$BUCKET"
  print -r -- "R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID"; print -r -- "R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY"; } > "$TMP"
supabase secrets set --project-ref "$PROD" --env-file "$TMP" >/dev/null 2>&1; code=$?
cleanup                                             # the key file is gone before anything else happens
(( code == 0 )) || { echo "FAILED: supabase secrets set"; exit 1; }
echo "   function secrets set"
for f in library-janitor library-health; do
  supabase functions deploy $f --project-ref "$PROD" --use-api --no-verify-jwt >/dev/null 2>&1 || { echo "FAILED: deploy $f"; exit 1; }
done
for f in library-upload library-download account-delete; do
  supabase functions deploy $f --project-ref "$PROD" --use-api >/dev/null 2>&1 || { echo "FAILED: deploy $f"; exit 1; }
done
echo "   functions redeployed"
echo "DONE. Tell Claude: R2 done. (Claude then runs the database part and turns on the backup health check.)"

# Cloud media backup to Cloudflare R2 — activation plan

Status 2026-10-12: code built and tested locally (janitor steps 8–9, `_shared/r2.ts`, tests R1–R4, W-tests);
**not active anywhere**. Not approved for execution. Owner decides each step.

## What it is
Supabase daily database backups do **not** contain Storage objects (the users' MP3 files). R2 keeps one copy of
every `ready` cloud sound in bucket `snipring-media-backup` (EU jurisdiction), same key as in Storage
(`<user id>/<item id>.mp3`). The janitor copies new items (≤ 20 per run) and marks `library_items.backup_at`.
Deleting a sound removes the R2 copy **first**; a row becomes `purged` only when no copy is left anywhere.
R2 copies without a live row are removed after 1 hour (orphan sweep).

## Privacy
- New processor: Cloudflare (R2), EU jurisdiction only. The setup script refuses a non-EU bucket.
- Same data as Storage (user audio), no extra metadata (no names, no e-mails).
- Account deletion and sound deletion remove the R2 copy (covered by tests R2 and `removeEverywhere`).
- **Before enabling:** update `privacy.html` (he + en): today it says there is no separate backup. New text must
  name Cloudflare R2 (EU), say what is copied, and that deleted sounds are removed from the backup too.
  Raise `consentVersion` only if the owner treats this as a material change. Owner approves the wording.

## Permissions
- R2 API token: **Object Read & Write**, scoped to the single bucket `snipring-media-backup`, no account-wide rights.
  Never an account API token.
- The keys live only in production function secrets (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`), set by `supabase/rollout/prod_r2_backup.sh` from hidden prompts.
- The browser never talks to R2. Only the janitor and account-delete functions do.
- Follow-up before use: give `prod_r2_backup.sh` the same cleanup trap as `prod_alerts.sh` (today it removes the
  temp file right after use but not on Ctrl+C between creation and removal). Small change; not in this task's scope.

## Cost (Cloudflare R2 public pricing; verify on the day)
- Storage: first 10 GB-month free, then about $0.015 per GB-month. The project cap is 800 MB → inside the free tier.
- Class A operations (PUT, LIST): 1 million/month free. Janitor: ≤ 20 PUT per 10 min + 1 LIST per run
  ≈ 4,400 LIST + uploads per month → far below the free tier.
- Class B (GET): 10 million/month free (only used in a restore). Egress: free.
- Expected cost: **$0**, as long as the 800 MB project cap stays.

## Activation order (each step = owner, each needs approval)
1. Read-only check (Claude): production has `library_items.backup_at`, `lib_backup_due/done`, `lib_live_paths`,
   `backup_lag` in `library_health`, setting `backup_enabled` = false.
2. Privacy text updated and merged.
3. Cloudflare: create bucket `snipring-media-backup` with **Specify jurisdiction → European Union**; create the
   bucket-scoped token. (Already started on 2026-10-11; re-check jurisdiction.)
4. `zsh supabase/rollout/prod_r2_backup.sh` from an up-to-date `main`: proves write/delete/list on the EU
   endpoint with a tiny test object, then stores the secrets and redeploys the functions.
5. SQL Editor: `update private.settings set value = 'true' where key = 'backup_enabled';` — from now on
   `ops_health().backup_current` is watched (lag > 2 h = alert).
6. Watch: janitor reports `backup: "on"`, `backed_up`, `backup_failed: 0`; `library_health.backup_lag` reaches 0.

## Integrity checks
- Per run: janitor counts `backup_failed`; health fails when a ready item is not backed up after 2 hours.
- Weekly (owner, read-only): every `ready` item has `backup_at`; R2 object count = count of ready rows
  (± items in flight); no R2 key without a live row older than 1 h.
- Content check (proposal, not built): a read-only script that downloads a random sample of R2 objects and
  compares SHA-256 with `library_items.sha256` (hashes only, never prints user ids). R2 PUT is also verifiable by
  its ETag (MD5 of the body); the janitor could check it on upload. **REQUIRES APPROVAL.**

## Restore from R2 (when Storage lost files)
1. List `ready` rows whose Storage object is missing (read-only SQL on `storage.objects`).
2. For each: GET from R2, check SHA-256 against the row, upload to Storage at the same path (service key,
   on the owner's computer). Never overwrite an existing object.
3. Run the janitor audit; `bytes_tracked` must stay true.
A restore script does not exist yet (to be written and tested on staging before it is ever needed).

## Rollback
`update private.settings set value = 'false' where key = 'backup_enabled';`, unset the four R2 secrets,
redeploy → steps 8–9 off. The bucket can then be emptied and deleted in Cloudflare (owner).

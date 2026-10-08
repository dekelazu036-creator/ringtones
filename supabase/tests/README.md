# Phase 1B tests

## Local (no Supabase project involved)
```bash
supabase/tests/run_all.sh
```
Needs Postgres 16 (scratch cluster), Node 22+ and ffmpeg. It creates throw-away databases
`snipring_test`, `snipring_conc`, `snipring_fn_test`.

| Suite | File | What it covers |
|---|---|---|
| SQL security + behaviour (110) | `library_1b_test.sql` | catalog checks (definer/search_path, grants, RLS, storage policies), role boundaries for anon/authenticated/service_role, upload flow, idempotency, duplicates, quotas, expiry, deletion, purge backoff, switches, orphans, audit, tombstones, lease |
| Teardown (4) | `run_local.sh` | teardown refuses with data present, removes only 1B objects, 1A untouched, re-install works |
| Concurrency (12) | `library_1b_concurrency.sh` | parallel sessions: duplicates, item quota, project cap, finish ∥ delete, lease, purge ∥ audit |
| MP3 check (14) | `functions/tests/mp3.test.ts` | site encoder output, repo sounds, ffmpeg variants accepted; WAV/OGG/AAC/MP2/random/HTML/smuggled payloads refused; CPU budget |
| Function logic (18) | `functions/tests/library.test.ts` | library.ts against the real SQL; fake Auth/Storage |
| Deno wiring (5 ×2) | `functions/tests/wiring.test.ts` | real entry points + bundles with a recording supabase-js fake |

## Where the local stub differs from hosted Supabase
`stub_supabase.sql` recreates roles, `auth.uid()/auth.role()`, `storage.buckets/objects` (RLS on,
broad grants) and Supabase's default privileges on `public`. It does **not** include:
the Storage API server (its own checks, bucket limits, signed URLs), PostgREST, the API gateway
(`verify_jwt`, key → role mapping), Auth (`getUser`), Vault, pg_cron/pg_net, or hosted ownership
of `storage.*`. Those are covered only by the staging tests (`staging/staging_test.mjs`, TEST_MATRIX.md).

## Harness note
psql treats an identifier named `begin` inside `CREATE FUNCTION` as the start of a
`BEGIN ATOMIC` body and stops splitting statements — the rest of the file then runs as one
transaction. Test helpers therefore never use `begin` as a name.

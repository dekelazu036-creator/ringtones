#!/usr/bin/env bash
# Concurrency tests for library_1b.sql: many sessions at once against a LOCAL scratch database.
# LOCAL ONLY (stub). Run after run_local.sh has applied the migration:  tests/library_1b_concurrency.sh
set -uo pipefail
DB=${DB:-snipring_conc}
cd "$(dirname "$0")/.."
sudo -u postgres dropdb --if-exists "$DB" >/dev/null 2>&1
sudo -u postgres createdb "$DB"
q()  { sudo -u postgres psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
for f in tests/stub_supabase.sql schema.sql auth_1a.sql library_1b.sql; do q -f "$f" >/dev/null 2>&1 || { echo "setup failed at $f"; exit 1; }; done

SVC="set role service_role; set request.jwt.claims = '{\"role\":\"service_role\"}';"
U() { printf '00000000-0000-0000-0000-%012d' "$1"; }
fails=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1  ($2)"; else echo "FAIL  $1  (got $2, want $3)"; fails=$((fails+1)); fi; }
OUT=$(mktemp -d)
chmod 777 "$OUT"

q -c "insert into auth.users (id) select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 9) g;
      insert into private.cloud_access (user_id) select id from auth.users;
      update private.settings set value = 'true' where key = 'reservations_open';
      update private.settings set value = value || '{\"max_uploading\": 1000, \"per_hour\": 1000}' where key = 'limits';"

sha() { printf '%064x' "$1"; }

# ---- C1: 20 simultaneous uploads of the SAME content by one user → exactly one reservation
for i in $(seq 1 20); do q -c "$SVC select coalesce(public.svc_library('begin', jsonb_build_object('user_id','$(U 1)','client_key',gen_random_uuid(),'name','c','type','ring','duration_ms',20000,'size',1000,'sha256','$(sha 1)','origin','file','allow_duplicate',false)) ->> 'status', 'err')" > "$OUT/c1_$i" 2>&1 & done; wait
check "C1 same content x20 concurrently → 1 upload"     "$(cat "$OUT"/c1_* | grep -c '^upload$')" 1
check "C1 … the other 19 are reported as duplicates"    "$(cat "$OUT"/c1_* | grep -c '^duplicate$')" 19

# ---- C2: item quota 5, 20 simultaneous different files → exactly 5 reserved
q -c "update private.settings set value = value || '{\"max_items\": 5}' where key = 'limits'"
for i in $(seq 1 20); do q -c "$SVC select coalesce(public.svc_library('begin', jsonb_build_object('user_id','$(U 2)','client_key',gen_random_uuid(),'name','c','type','ring','duration_ms',20000,'size',1000,'sha256','$(sha $((100+i)))','origin','file','allow_duplicate',false)) ->> 'error', 'upload')" > "$OUT/c2_$i" 2>&1 & done; wait
check "C2 quota 5 under 20 concurrent begins → 5 uploads" "$(cat "$OUT"/c2_* | grep -c '^upload$')" 5
check "C2 … 15 refused with quota_items"                  "$(cat "$OUT"/c2_* | grep -c '^quota_items$')" 15
q -c "update private.settings set value = value || '{\"max_items\": 100}' where key = 'limits'"

# ---- C3: project-wide cap shared by 5 users, 30 concurrent begins of 1000 bytes; room for 10 more
used=$(q -c "select coalesce(sum(bytes_active + bytes_releasing),0) from private.library_usage")
q -c "update private.settings set value = value || jsonb_build_object('project_physical', $used + 10000) where key = 'limits'"
for i in $(seq 1 30); do u=$(( 3 + i % 5 )); q -c "$SVC select coalesce(public.svc_library('begin', jsonb_build_object('user_id','$(U $u)','client_key',gen_random_uuid(),'name','c','type','ring','duration_ms',20000,'size',1000,'sha256','$(sha $((500+i)))','origin','file','allow_duplicate',false)) ->> 'error', 'upload')" > "$OUT/c3_$i" 2>&1 & done; wait
check "C3 project cap under 30 concurrent begins (5 users) → exactly 10" "$(cat "$OUT"/c3_* | grep -c '^upload$')" 10
check "C3 … total counted bytes never exceed the cap" \
  "$(q -c "select (select sum(bytes_active + bytes_releasing) from private.library_usage) <= (select (value->>'project_physical')::bigint from private.settings where key='limits')")" t
q -c "update private.settings set value = value || '{\"project_physical\": 838860800}' where key = 'limits'"

# ---- C4: finish and delete racing on the same 15 items (user 2's uploads, objects present)
q -c "insert into storage.objects (bucket_id, name, metadata)
      select 'user-media', storage_path, jsonb_build_object('size', size_bytes, 'mimetype', 'audio/mpeg')
        from public.library_items where user_id = '$(U 2)' and state = 'uploading'"
ids=$(q -c "select id from public.library_items where user_id = '$(U 2)' and state = 'uploading'")
for id in $ids; do
  q -c "$SVC select public.svc_library('finish', jsonb_build_object('user_id','$(U 2)','id','$id')) ->> 'status'" > "$OUT/c4f_$id" 2>&1 &
  q -c "set role authenticated; set request.jwt.claims = '{\"role\":\"authenticated\",\"sub\":\"$(U 2)\"}'; select public.library_delete('$id')" > "$OUT/c4d_$id" 2>&1 &
done; wait
check "C4 finish ∥ delete: every item ends deleting or abandoned (never ready-and-deleted)" \
  "$(q -c "select count(*) from public.library_items where user_id = '$(U 2)' and state not in ('deleting','abandoned')")" 0
check "C4 … no SQL errors or deadlocks" "$(cat "$OUT"/c4* | grep -ci 'error\|deadlock')" 0

# ---- C5: janitor ∥ janitor: 10 simultaneous lease attempts → exactly one wins
for i in $(seq 1 10); do q -c "$SVC select public.svc_library('janitor_acquire', jsonb_build_object('holder','h$i','secs',60))" > "$OUT/c5_$i" 2>&1 & done; wait
check "C5 janitor lease: one winner out of 10" "$(cat "$OUT"/c5_* | grep -c '^true$')" 1

# ---- C6: purge ∥ delete ∥ audit on user 1's objects (move the reservation to ready, then delete and purge concurrently)
q -c "insert into storage.objects (bucket_id, name, metadata)
      select 'user-media', storage_path, jsonb_build_object('size', size_bytes, 'mimetype', 'audio/mpeg')
        from public.library_items where user_id = '$(U 1)' and state = 'uploading'"
id1=$(q -c "select id from public.library_items where user_id = '$(U 1)' and state = 'uploading' limit 1")
q -c "$SVC select public.svc_library('finish', jsonb_build_object('user_id','$(U 1)','id','$id1'))" >/dev/null
q -c "set role authenticated; set request.jwt.claims = '{\"role\":\"authenticated\",\"sub\":\"$(U 1)\"}'; select public.library_delete('$id1')" >/dev/null
q -c "update public.library_items set purge_next_at = now() - interval '1 second' where id = '$id1'"
q -c "delete from storage.objects where name = (select storage_path from public.library_items where id = '$id1')"
for i in $(seq 1 8); do
  q -c "$SVC select public.svc_library('purged', jsonb_build_object('id','$id1'))" > "$OUT/c6p_$i" 2>&1 &
  q -c "$SVC select public.svc_library('audit_user', jsonb_build_object('user_id','$(U 1)'))" > "$OUT/c6a_$i" 2>&1 &
  q -c "$SVC select public.svc_library('prune_usage', '{}')" > "$OUT/c6u_$i" 2>&1 &
done; wait
check "C6 8 concurrent purges release the bytes exactly once" \
  "$(q -c "select bytes_releasing from private.library_usage where user_id = '$(U 1)'")" 0
check "C6 … no SQL errors or deadlocks" "$(cat "$OUT"/c6* | grep -ci 'error\|deadlock')" 0
check "C6 … concurrent prunes keep the row of a user who still has items" \
  "$(q -c "select count(*) from private.library_usage where user_id = '$(U 1)'")" 1

AUTH() { printf "set role authenticated; set request.jwt.claims = '{\"role\":\"authenticated\",\"sub\":\"%s\"}';" "$1"; }

# ---- C7: 20 simultaneous deletes of unknown ids by a user outside the beta → no usage row is ever created
q -c "insert into auth.users (id) values ('$(U 10)')"
for i in $(seq 1 20); do q -c "$(AUTH "$(U 10)") select public.library_delete(gen_random_uuid())" > "$OUT/c7_$i" 2>&1 & done; wait
check "C7 20 concurrent refused deletes → all not_found" "$(cat "$OUT"/c7_* | grep -c '^not_found$')" 20
check "C7 … no usage row created"                     "$(q -c "select count(*) from private.library_usage where user_id = '$(U 10)'")" 0
check "C7 … the account can still be deleted"         "$(q -c "with d as (delete from auth.users where id = '$(U 10)' returning 1) select count(*) from d")" 1

# ---- C8: 10 simultaneous deletes of the same ready item → all answer deleting, counters move once
q -c "$SVC select public.svc_library('begin', jsonb_build_object('user_id','$(U 8)','client_key',gen_random_uuid(),'name','c','type','ring','duration_ms',20000,'size',1000,'sha256','$(sha 800)','origin','file','allow_duplicate',false))" >/dev/null
id8=$(q -c "select id from public.library_items where user_id = '$(U 8)'")
q -c "insert into storage.objects (bucket_id, name, metadata)
      select 'user-media', storage_path, jsonb_build_object('size', size_bytes, 'mimetype', 'audio/mpeg') from public.library_items where id = '$id8'"
q -c "$SVC select public.svc_library('finish', jsonb_build_object('user_id','$(U 8)','id','$id8'))" >/dev/null
for i in $(seq 1 10); do q -c "$(AUTH "$(U 8)") select public.library_delete('$id8')" > "$OUT/c8_$i" 2>&1 & done; wait
check "C8 10 concurrent deletes of one item → all deleting" "$(cat "$OUT"/c8_* | grep -c '^deleting$')" 10
check "C8 … counters moved exactly once (items/active/releasing)" \
  "$(q -c "select items_active || '/' || bytes_active || '/' || bytes_releasing from private.library_usage where user_id = '$(U 8)'")" "0/0/1000"

# ---- C9: prune ∥ begin on 30 beta users whose usage rows are empty → every begin succeeds, no item without its row
q -c "insert into auth.users (id)            select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(11, 40) g;
      insert into private.cloud_access (user_id)  select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(11, 40) g;
      insert into private.library_usage (user_id) select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(11, 40) g;"
for i in $(seq 11 40); do
  q -c "$SVC select coalesce(public.svc_library('begin', jsonb_build_object('user_id','$(U $i)','client_key',gen_random_uuid(),'name','c','type','ring','duration_ms',20000,'size',1000,'sha256','$(sha $((900+i)))','origin','file','allow_duplicate',false)) ->> 'status', 'err')" > "$OUT/c9b_$i" 2>&1 &
  q -c "$SVC select public.svc_library('prune_usage', '{}')" > "$OUT/c9p_$i" 2>&1 &
done; wait
check "C9 prune ∥ begin (30 users) → every begin reserved"  "$(cat "$OUT"/c9b_* | grep -c '^upload$')" 30
check "C9 … no SQL errors or deadlocks"                     "$(cat "$OUT"/c9* | grep -ci 'error\|deadlock')" 0
check "C9 … no item exists without its usage row" \
  "$(q -c "select count(*) from public.library_items li where not exists (select 1 from private.library_usage lu where lu.user_id = li.user_id)")" 0

# ---- C10: deterministic worst case for begin: prune holds the row lock, then deletes the row; begin must retry and succeed
q -c "insert into auth.users (id) values ('$(U 41)'); insert into private.cloud_access (user_id) values ('$(U 41)');
      insert into private.library_usage (user_id) values ('$(U 41)')"
q -c "begin; select 1 from private.library_usage where user_id = '$(U 41)' for update; select pg_sleep(1.5);
      delete from private.library_usage where user_id = '$(U 41)'; commit;" > "$OUT/c10p" 2>&1 &
q -c "select pg_sleep(0.5); $SVC select coalesce(public.svc_library('begin', jsonb_build_object('user_id','$(U 41)','client_key',gen_random_uuid(),'name','c','type','ring','duration_ms',20000,'size',1000,'sha256','$(sha 941)','origin','file','allow_duplicate',false)) ->> 'status', 'err')" > "$OUT/c10b" 2>&1 &
wait
check "C10 begin waiting on a row that is then deleted retries and reserves" "$(tail -1 "$OUT/c10b")" upload
check "C10 … row recreated with the reservation counted" \
  "$(q -c "select items_active || '/' || uploading_count from private.library_usage where user_id = '$(U 41)'")" "1/1"

# ---- C11: prune skips (never waits for, never deletes) a row an in-flight writer holds
q -c "insert into auth.users (id) values ('$(U 42)'); insert into private.library_usage (user_id) values ('$(U 42)')"
q -c "begin; select 1 from private.library_usage where user_id = '$(U 42)' for update; select pg_sleep(2); commit;" > "$OUT/c11w" 2>&1 &
q -c "select pg_sleep(0.5)" >/dev/null
t0=$(date +%s%N)
c11=$(q -c "$SVC select public.svc_library('prune_usage', '{}')" | tail -1)
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
wait
check "C11 prune skips the locked row without waiting (pruned|fast)" "$c11|$([ "$ms" -lt 1000 ] && echo fast || echo "slow ${ms}ms")" "0|fast"
check "C11 … the locked row is still there"   "$(q -c "select count(*) from private.library_usage where user_id = '$(U 42)'")" 1

# ---- Z: every user's counters equal what their rows say (audit finds no drift)
drift=$(q -c "set request.jwt.claims = '{\"role\":\"service_role\"}'; select count(*) filter (where public.svc_library('audit_user', jsonb_build_object('user_id', u.id)) = 'true'::jsonb) from auth.users u where exists (select 1 from public.library_items li where li.user_id = u.id)" 2>&1)
check "Z counters equal rows for every user after all races" "$drift" 0

rm -rf "$OUT"
echo "concurrency: $fails failed"
[ "$fails" -eq 0 ]

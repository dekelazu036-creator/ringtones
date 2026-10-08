-- =====================================================================
-- Local security + behaviour tests for library_1b.sql.  LOCAL STUB ONLY (see run_local.sh).
-- Each check writes a row to tst.results; the run fails if any check is false.
-- Users: A = ...a1, B = ...b2, C = ...c3 (not in the beta allow-list).
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create schema tst;
grant usage on schema tst to public;
create table tst.results (n serial primary key, name text not null, ok boolean, info text);
grant all on tst.results to public;
grant all on sequence tst.results_n_seq to public;

create function tst.ok(p_name text, p_ok boolean, p_info text default null) returns void language sql as $$
  insert into tst.results (name, ok, info) values (p_name, coalesce(p_ok, false), p_info) $$;
-- run SQL as the CURRENT role; return '' on success or 'SQLSTATE: message'
create function tst.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return '';
exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create function tst.act(p_role text, p_uid uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_role is null then '' else jsonb_build_object('role', p_role, 'sub', p_uid)::text end, false);
  perform set_config('role', coalesce(p_role, 'none'), false);
end $$;
create function tst.back() returns void language plpgsql as $$
begin perform set_config('role', 'none', false); perform set_config('request.jwt.claims', '', false); end $$;
-- what an Edge Function does: call the dispatcher as service_role over the API
create function tst.svc(p_op text, p_args jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tst.act('service_role');
  r := public.svc_library(p_op, p_args);
  perform tst.back();
  return r;
end $$;
-- simulate the Storage API writing an object (what library-upload's storage upload does)
create function tst.put(p_path text, p_size bigint, p_mime text default 'audio/mpeg', p_age interval default '0') returns void
language sql as $$
  insert into storage.objects (bucket_id, name, metadata, created_at)
  values ('user-media', p_path, jsonb_build_object('size', p_size, 'mimetype', p_mime), now() - p_age) $$;
create function tst.rm(p_path text) returns void language sql as $$
  delete from storage.objects where bucket_id = 'user-media' and name = p_path $$;
create function tst.sha(p text) returns text language sql as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
create function tst.reserve(p_uid uuid, p_key uuid, p_sha text, p_size bigint default 1000, p_dup boolean default false,
                          p_name text default 'Ring', p_dur int default 20000, p_origin text default 'file')
returns jsonb language sql as $$
  select tst.svc('begin', jsonb_build_object('user_id', p_uid, 'client_key', p_key, 'name', p_name, 'type', 'ring',
    'duration_ms', p_dur, 'size', p_size, 'sha256', p_sha, 'origin', p_origin, 'allow_duplicate', p_dup)) $$;
create function tst.usage(p_uid uuid) returns jsonb language sql as $$
  select to_jsonb(u) - 'updated_at' - 'audited_at' - 'user_id' from private.library_usage u where user_id = p_uid $$;
create function tst.u(p_uid uuid, items int, active bigint, releasing bigint, up int) returns boolean language sql as $$
  select tst.usage(p_uid) = jsonb_build_object('items_active', items, 'bytes_active', active,
                                                'bytes_releasing', releasing, 'uploading_count', up) $$;
create function tst.state(p_id uuid) returns text language sql as $$ select state from public.library_items where id = p_id $$;
create function tst.path(p_id uuid) returns text language sql as $$ select storage_path from public.library_items where id = p_id $$;
create function tst.id(j jsonb) returns uuid language sql as $$ select (j ->> 'id')::uuid $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@example.test');
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b2'''
\set C '''00000000-0000-0000-0000-0000000000c3'''

-- ===================================================================== S. static checks on the catalog
select tst.ok('S1 every SECURITY DEFINER function in public/private pins search_path',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('public','private') and p.prosecdef
                 and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  (select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')));
select tst.ok('S2 no API role can use schema private',
  not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage')
  and not has_schema_privilege('service_role', 'private', 'usage'));
select tst.ok('S3 no API role can execute any function in private',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon','authenticated','service_role']) r
               where n.nspname = 'private' and has_function_privilege(r, p.oid, 'execute')));
select tst.ok('S4 no API role has any table privilege in private',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['anon','authenticated','service_role']) r
               where n.nspname = 'private' and c.relkind in ('r','v')
                 and has_table_privilege(r, c.oid, 'select,insert,update,delete,truncate,references,trigger')));
-- every function in public that anon may execute (extension-owned functions excluded) must be on this list
select tst.ok('S5 anon can execute only the known public functions',
  coalesce((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
               and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
           '{}') <@ array['bump_sound','search_sounds','sounds_search_refresh','trending_sounds'],
  (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')));
select tst.ok('S5b trigger function sounds_search_refresh is not executable by anon',
  not has_function_privilege('anon', 'public.sounds_search_refresh()', 'execute'));
select tst.ok('S6 svc_library executable by service_role only',
  has_function_privilege('service_role', 'public.svc_library(text,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.svc_library(text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.svc_library(text,jsonb)', 'execute'));
select tst.ok('S7 browser functions executable by authenticated only',
  (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
     from unnest(array['public.library_delete(uuid)','public.library_job_status(uuid[])','public.library_usage()']::regprocedure[]) f));
select tst.ok('S8 library_items: authenticated may only SELECT (column-limited), others nothing',
  not has_table_privilege('anon', 'public.library_items', 'select,insert,update,delete,truncate')
  and not has_table_privilege('service_role', 'public.library_items', 'select,insert,update,delete,truncate')
  and not has_table_privilege('authenticated', 'public.library_items', 'insert,update,delete,truncate')
  and has_column_privilege('authenticated', 'public.library_items', 'name', 'select')
  and not has_column_privilege('authenticated', 'public.library_items', 'user_id', 'select')
  and not has_column_privilege('authenticated', 'public.library_items', 'storage_path', 'select')
  and not has_column_privilege('authenticated', 'public.library_items', 'content_sha256', 'select'));
select tst.ok('S9 RLS enabled on library_items and all private tables',
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where (n.nspname = 'private' and c.relkind = 'r') or c.oid = 'public.library_items'::regclass));
select tst.ok('S10 no storage policy at all (nothing grants the browser access to user-media)',
  not exists (select 1 from pg_policies where schemaname = 'storage'));
select tst.ok('S11 bucket user-media is private, 10 MiB, audio/mpeg only',
  exists (select 1 from storage.buckets where id = 'user-media' and public = false
           and file_size_limit = 10485760 and allowed_mime_types = array['audio/mpeg']));
select tst.ok('S12 profiles: anon has no privileges; authenticated may select (RLS: own row)',
  not has_table_privilege('anon', 'public.profiles', 'select,insert,update,delete')
  and has_table_privilege('authenticated', 'public.profiles', 'select')
  and not exists (select 1 from pg_policies where tablename = 'profiles' and 'anon' = any (roles)));

-- ===================================================================== P. role boundaries at run time
select tst.act('anon');
select tst.ok('P1 anon cannot read library_items',  tst.err('select * from public.library_items') like '42501%');
select tst.ok('P2 anon cannot call library_delete', tst.err('select public.library_delete(gen_random_uuid())') like '42501%');
select tst.ok('P3 anon cannot call svc_library',    tst.err('select public.svc_library(''expired'', ''{}'')') like '42501%');
select tst.ok('P4 anon cannot read profiles',       tst.err('select * from public.profiles') like '42501%');
select tst.ok('P5 anon sees no user-media objects (RLS)', (select count(*) from storage.objects) = 0);
select tst.back();

select tst.act('authenticated', :A);
select tst.ok('P6 authenticated cannot call svc_library', tst.err('select public.svc_library(''expired'', ''{}'')') like '42501%');
select tst.ok('P7 authenticated cannot insert library_items',
  tst.err($$insert into public.library_items (user_id, client_key, name, type, duration_ms, size_bytes, content_sha256, origin, state)
            values (auth.uid(), gen_random_uuid(), 'x', 'ring', 1000, 1, repeat('a',64), 'file', 'ready')$$) like '42501%');
select tst.ok('P8 authenticated cannot update library_items', tst.err('update public.library_items set name = ''x''') like '42501%');
select tst.ok('P9 authenticated cannot delete library_items', tst.err('delete from public.library_items') like '42501%');
select tst.ok('P10 authenticated cannot touch private tables', tst.err('select * from private.library_usage') like '42501%');
select tst.ok('P11 authenticated cannot call private functions', tst.err('select private.lib_finish(auth.uid(), gen_random_uuid())') like '42501%');
select tst.ok('P12 authenticated cannot insert into storage.objects (no policy)',
  tst.err($$insert into storage.objects (bucket_id, name, metadata) values ('user-media', auth.uid()::text || '/x.mp3', '{"size":1}')$$) like '42501%');
select tst.ok('P13 authenticated cannot read hidden columns', tst.err('select storage_path from public.library_items') like '42501%');
select tst.back();

-- service_role must not bypass: direct table access revoked, dispatcher checks the JWT role claim
select tst.act('service_role');
select tst.ok('P14 service_role has no direct access to library_items', tst.err('select * from public.library_items') like '42501%');
select tst.ok('P15 service_role cannot read private tables', tst.err('select * from private.settings') like '42501%');
select tst.back();
select tst.ok('P16 svc_library rejects a caller without the service_role claim (even the owner)',
  tst.err('select public.svc_library(''expired'', ''{}'')') like '42501%');
select set_config('role', 'service_role', false), set_config('request.jwt.claims', '{"role":"authenticated"}', false);
select tst.ok('P17 svc_library rejects service_role grant with a non-service claim', tst.err('select public.svc_library(''expired'', ''{}'')') like '42501%');
select tst.back();

-- ===================================================================== F. upload flow
insert into private.cloud_access (user_id) values (:A), (:B);
select tst.ok('F1 reservations closed by default', tst.reserve(:A, gen_random_uuid(), tst.sha('x')) ->> 'error' = 'reservations_closed');
update private.settings set value = 'true' where key = 'reservations_open';
select tst.ok('F2 user outside the beta allow-list is refused (and gets no usage row)', tst.reserve(:C, gen_random_uuid(), tst.sha('x')) ->> 'error' = 'not_enabled'
  and tst.usage(:C) is null);

select tst.ok('F3 input validation',
      tst.reserve(:A, gen_random_uuid(), 'nothex')                       ->> 'error' = 'bad_hash'
  and tst.reserve(:A, gen_random_uuid(), null)                           ->> 'error' = 'bad_hash'
  and tst.reserve(:A, gen_random_uuid(), tst.sha('x'), 10485761)         ->> 'error' = 'file_too_large'
  and tst.reserve(:A, gen_random_uuid(), tst.sha('x'), 0)                ->> 'error' = 'file_too_large'
  and tst.reserve(:A, gen_random_uuid(), tst.sha('x'), 1000, false, 'n', 50)      ->> 'error' = 'bad_duration'
  and tst.reserve(:A, gen_random_uuid(), tst.sha('x'), 1000, false, 'n', 20000, 'evil') ->> 'error' = 'bad_request');
select tst.ok('F3b validation failures reserve nothing', tst.usage(:A) is null or tst.u(:A, 0, 0, 0, 0));

create temp table j (k text primary key, v jsonb);
grant all on j to public;
insert into j values ('k1', jsonb_build_object('key', gen_random_uuid()));
insert into j select 'r1', tst.reserve(:A, (select (v->>'key')::uuid from j where k='k1'), tst.sha('one'), 5000);
select tst.ok('F4 begin reserves and counts immediately',
  (select v ->> 'status' = 'upload' from j where k = 'r1') and tst.u(:A, 1, 5000, 0, 1));
select tst.ok('F5 path is <uid>/<id>.mp3 and fixed by the server',
  (select v ->> 'path' = :A || '/' || (v ->> 'id') || '.mp3' from j where k = 'r1'));
select tst.ok('F6 same client_key again returns the same reservation (lost response)',
  tst.id(tst.reserve(:A, (select (v->>'key')::uuid from j where k='k1'), tst.sha('one'), 5000)) = (select tst.id(v) from j where k='r1')
  and tst.u(:A, 1, 5000, 0, 1));
select tst.ok('F7 same client_key with other bytes returns the ORIGINAL sha/size (function must refuse)',
  (select r ->> 'sha256' = tst.sha('one') and (r ->> 'size')::int = 5000
     from (select tst.reserve(:A, (select (v->>'key')::uuid from j where k='k1'), tst.sha('two'), 7000) r) t));
select tst.ok('F8 finish before the object exists → object_missing, still uploading',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r1'))) ->> 'error' = 'object_missing'
  and tst.state((select tst.id(v) from j where k='r1')) = 'uploading');
select tst.ok('F9 another user cannot finish it',
  tst.svc('finish', jsonb_build_object('user_id', :B, 'id', (select tst.id(v) from j where k='r1'))) ->> 'error' = 'not_found');
select tst.put(tst.path((select tst.id(v) from j where k='r1')), 5000);
select tst.ok('F10 finish with matching object → ready; counters unchanged except uploading',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r1'))) ->> 'status' = 'done'
  and tst.state((select tst.id(v) from j where k='r1')) = 'ready' and tst.u(:A, 1, 5000, 0, 0));
select tst.ok('F11 finish again is idempotent',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r1'))) ->> 'status' = 'done'
  and tst.u(:A, 1, 5000, 0, 0));
select tst.ok('F12 begin with the same client_key after ready → done',
  tst.reserve(:A, (select (v->>'key')::uuid from j where k='k1'), tst.sha('one'), 5000) ->> 'status' = 'done');
select tst.ok('F13 same content, new job → duplicate (no reservation)',
  tst.reserve(:A, gen_random_uuid(), tst.sha('one'), 5000) ->> 'status' = 'duplicate' and tst.u(:A, 1, 5000, 0, 0));
select tst.ok('F14 B may store the same content (duplicates are per user)',
  tst.reserve(:B, gen_random_uuid(), tst.sha('one'), 5000) ->> 'status' = 'upload');

-- size mismatch between reservation and stored object
insert into j select 'r2', tst.reserve(:A, gen_random_uuid(), tst.sha('two'), 3000);
select tst.put(tst.path((select tst.id(v) from j where k='r2')), 9999);
select tst.ok('F15 stored object larger than measured → mismatch, abandoned, bytes move to releasing',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r2'))) ->> 'error' = 'mismatch'
  and tst.state((select tst.id(v) from j where k='r2')) = 'abandoned' and tst.u(:A, 1, 5000, 3000, 0));
insert into j select 'r3', tst.reserve(:A, gen_random_uuid(), tst.sha('three'), 3000);
select tst.put(tst.path((select tst.id(v) from j where k='r3')), 3000, 'audio/wav');
select tst.ok('F16 stored object with other mimetype → mismatch',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r3'))) ->> 'error' = 'mismatch');
select tst.ok('F17 abandoned job cannot be finished or resumed',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r2'))) ->> 'error' = 'job_closed'
  and tst.reserve(:A, (select (v->>'key')::uuid from j where k='k1'), tst.sha('one')) ->> 'status' = 'done');

-- ===================================================================== R. RLS + browser functions
select tst.act('authenticated', :A);
select tst.ok('R1 A lists only own READY items', (select count(*) from public.library_items) = 1);
select tst.ok('R2 job status for own keys only',
  (select count(*) from public.library_job_status(array[(select (v->>'key')::uuid from j where k='k1'), gen_random_uuid()])) = 1);
select tst.ok('R3 usage() returns own counters', (public.library_usage() ->> 'items')::int = 1 and (public.library_usage() ->> 'enabled')::boolean);
select tst.back();
select tst.act('authenticated', :B);
select tst.ok('R4 B sees none of A''s items', (select count(*) from public.library_items) = 0);
select tst.ok('R5 B cannot see A''s job status', (select count(*) from public.library_job_status(array[(select (v->>'key')::uuid from j where k='k1')])) = 0);
select tst.ok('R6 B cannot delete A''s item', public.library_delete((select tst.id(v) from j where k='r1')) = 'not_found');
select tst.back();
select tst.ok('R7 A''s item untouched after B''s attempt', tst.state((select tst.id(v) from j where k='r1')) = 'ready');
select tst.ok('R8 download path only for the owner and only when ready',
  tst.svc('ready_item', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r1'))) ->> 'path' like :A || '/%'
  and tst.svc('ready_item', jsonb_build_object('user_id', :B, 'id', (select tst.id(v) from j where k='r1'))) = 'null'::jsonb
  and tst.svc('ready_item', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r2'))) = 'null'::jsonb);

-- ===================================================================== D. deletion & janitor
select tst.act('authenticated', :A);
select tst.ok('D1 delete ready → deleting, bytes to releasing', public.library_delete((select tst.id(v) from j where k='r1')) = 'deleting');
select tst.ok('D2 delete again is idempotent', public.library_delete((select tst.id(v) from j where k='r1')) = 'deleting');
select tst.ok('D3 deleted item disappears from the list', (select count(*) from public.library_items) = 0);
select tst.back();
select tst.ok('D4 counters after delete', tst.u(:A, 0, 0, 5000 + 3000 + 3000, 0));
select tst.ok('D5 download refused after delete',
  tst.svc('ready_item', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r1'))) = 'null'::jsonb);
select tst.ok('D6 finish after delete → job_closed',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r1'))) ->> 'error' = 'job_closed');
select tst.ok('D7 nothing is due during the grace period', jsonb_array_length(tst.svc('due_purges', '{}')) = 0);
update public.library_items set purge_next_at = now() - interval '1 second' where state in ('deleting','abandoned');
select tst.ok('D8 due purges after grace', jsonb_array_length(tst.svc('due_purges', '{}')) = 3);
select tst.ok('D9 purged refused while the object still exists (quota NOT released)',
  tst.svc('purged', jsonb_build_object('id', (select tst.id(v) from j where k='r1'))) = '"still_present"'
  and tst.u(:A, 0, 0, 11000, 0));
select tst.svc('purge_failed', jsonb_build_object('id', (select tst.id(v) from j where k='r1'), 'error', 'still_present'));
select tst.ok('D10 failure backs off (10 min, then doubles)',
  (select purge_attempts = 1 and purge_next_at between now() + interval '9 minutes' and now() + interval '11 minutes'
     from public.library_items where id = (select tst.id(v) from j where k='r1')));
select tst.rm(tst.path((select tst.id(v) from j where k='r1')));
select tst.ok('D11 purged after the object is gone: quota released',
  tst.svc('purged', jsonb_build_object('id', (select tst.id(v) from j where k='r1'))) = '"purged"'
  and tst.u(:A, 0, 0, 6000, 0));
select tst.ok('D11b purged row keeps no name or hash',
  (select name = '-' and content_sha256 is null and purged_at is not null
         from public.library_items where id = (select tst.id(v) from j where k='r1')));
select tst.ok('D12 purged is idempotent', tst.svc('purged', jsonb_build_object('id', (select tst.id(v) from j where k='r1'))) = '"purged"'
  and tst.u(:A, 0, 0, 6000, 0));
-- abandoned items whose object never existed (or is removed) are purged too
select tst.rm(tst.path((select tst.id(v) from j where k='r2'))), tst.rm(tst.path((select tst.id(v) from j where k='r3')));
select tst.ok('D13 abandoned items purge and release',
  tst.svc('purged', jsonb_build_object('id', (select tst.id(v) from j where k='r2'))) = '"purged"'
  and tst.svc('purged', jsonb_build_object('id', (select tst.id(v) from j where k='r3'))) = '"purged"'
  and tst.u(:A, 0, 0, 0, 0));
select tst.ok('D14 purged rows still count for the hourly rate (rows kept as tombstones)',
  (select count(*) from public.library_items where user_id = :A and created_at > now() - interval '1 hour') = 3);

-- delete while uploading = cancel
insert into j select 'r4', tst.reserve(:A, gen_random_uuid(), tst.sha('four'), 2000);
select tst.act('authenticated', :A);
select tst.ok('D15 delete of an uploading item cancels it', public.library_delete((select tst.id(v) from j where k='r4')) = 'abandoned');
select tst.back();
select tst.put(tst.path((select tst.id(v) from j where k='r4')), 2000);
select tst.ok('D16 upload that lands after cancel cannot be finished; object will be purged',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r4'))) ->> 'error' = 'job_closed'
  and tst.u(:A, 0, 0, 2000, 0));

-- repeated failures → purge_stuck event
update public.library_items set purge_attempts = 4 where id = (select tst.id(v) from j where k='r4');
select tst.svc('purge_failed', jsonb_build_object('id', (select tst.id(v) from j where k='r4'), 'error', 'boom'));
select tst.ok('D17 fifth failure logs purge_stuck', exists (select 1 from private.library_events where kind = 'purge_stuck'));
select tst.ok('D18 backoff is capped at 6 hours',
  (select purge_next_at <= now() + interval '6 hours 1 second' from public.library_items where id = (select tst.id(v) from j where k='r4')));
update public.library_items set purge_attempts = 40 where id = (select tst.id(v) from j where k='r4');
select tst.ok('D19 backoff arithmetic does not overflow on many attempts',
  tst.err($$select public.svc_library('purge_failed', jsonb_build_object('id', (select (v->>'id') from j where k='r4'), 'error', 'x'))$$) like '42501%'
  and (select tst.svc('purge_failed', jsonb_build_object('id', (select tst.id(v) from j where k='r4'), 'error', 'x')) = 'true'::jsonb));

-- ===================================================================== E. expiry
insert into j select 'r5', tst.reserve(:A, gen_random_uuid(), tst.sha('five'), 1500);
update public.library_items set expires_at = now() - interval '1 second' where id = (select tst.id(v) from j where k='r5');
select tst.put(tst.path((select tst.id(v) from j where k='r5')), 1500);
select tst.ok('E1 finish after expiry → expired, abandoned (object purged later)',
  tst.svc('finish', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r5'))) ->> 'error' = 'expired'
  and tst.state((select tst.id(v) from j where k='r5')) = 'abandoned');
insert into j select 'r6', tst.reserve(:A, gen_random_uuid(), tst.sha('six'), 1500);
update public.library_items set expires_at = now() - interval '1 second' where id = (select tst.id(v) from j where k='r6');
select tst.ok('E2 janitor lists expired reservations', jsonb_array_length(tst.svc('expired', '{}')) = 1);
select tst.ok('E3 janitor abandons them', tst.svc('abandon', jsonb_build_object('user_id', :A, 'id', (select tst.id(v) from j where k='r6'), 'reason', 'expired')) = '"abandoned"');
insert into j select 'r7', tst.reserve(:A, gen_random_uuid(), tst.sha('seven'), 1500);
update public.library_items set expires_at = now() - interval '1 second' where id = (select tst.id(v) from j where k='r7');
select tst.ok('E4 a new begin releases the user''s own expired reservations (no janitor needed)',
  tst.reserve(:A, gen_random_uuid(), tst.sha('eight'), 1500) ->> 'status' = 'upload'
  and tst.state((select tst.id(v) from j where k='r7')) = 'abandoned');
select tst.ok('E5 counters consistent after expiry handling', tst.svc('audit_user', jsonb_build_object('user_id', :A)) = 'false'::jsonb);

-- ===================================================================== Q. quotas and limits
update private.settings set value = value || '{"max_uploading": 1}' where key = 'limits';
select tst.ok('Q1 concurrent uploads limit', tst.reserve(:A, gen_random_uuid(), tst.sha('q1')) ->> 'error' = 'too_many_uploads');
update private.settings set value = value || '{"max_uploading": 3, "max_items": 2}' where key = 'limits';
select tst.ok('Q2 an UPLOADING reservation counts as an item', tst.reserve(:A, gen_random_uuid(), tst.sha('q2')) ->> 'status' = 'upload'
  and tst.reserve(:A, gen_random_uuid(), tst.sha('q3')) ->> 'error' = 'quota_items');
update private.settings set value = value || '{"max_items": 100, "max_bytes": 5000}' where key = 'limits';
select tst.ok('Q3 byte quota counts reservations', tst.reserve(:A, gen_random_uuid(), tst.sha('q4'), 3000) ->> 'error' = 'quota_bytes');
update private.settings set value = value || '{"max_bytes": 104857600, "max_physical": 7000}' where key = 'limits';
select tst.ok('Q4 physical quota counts bytes still being released',
  tst.usage(:A) ->> 'bytes_releasing' <> '0'
  and tst.reserve(:A, gen_random_uuid(), tst.sha('q5'), 3000) ->> 'error' = 'quota_physical');
update private.settings set value = value || '{"max_physical": 157286400, "project_physical": 10000}' where key = 'limits';
select tst.ok('Q5 project-wide cap counts all users', tst.reserve(:B, gen_random_uuid(), tst.sha('q6'), 4000) ->> 'error' = 'service_full');
update private.settings set value = value || '{"project_physical": 838860800, "per_hour": 9}' where key = 'limits';
select tst.ok('Q6 hourly rate counts every job started in the last hour (incl. purged)',
  tst.reserve(:A, gen_random_uuid(), tst.sha('q7')) ->> 'error' = 'rate_limited');
update private.settings set value = value - 'per_hour' where key = 'limits';
select tst.ok('Q7 a MISSING limit fails closed (error, not unlimited)', tst.err($$select tst.reserve('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), tst.sha('q8'))$$) like 'P0001%');
update private.settings set value = value || '{"per_hour": 30}' where key = 'limits';
delete from private.settings where key = 'reservations_open';
select tst.ok('Q8 a MISSING reservations_open switch means closed', tst.reserve(:A, gen_random_uuid(), tst.sha('q9')) ->> 'error' = 'reservations_closed');
insert into private.settings (key, value) values ('reservations_open', 'true');

-- ===================================================================== W. switches
insert into j select 'w1', tst.reserve(:B, gen_random_uuid(), tst.sha('w1'), 1200);
select tst.put(tst.path((select tst.id(v) from j where k='w1')), 1200);
update private.settings set value = 'false' where key = 'reservations_open';
select tst.ok('W1 reservations closed: new uploads refused', tst.reserve(:B, gen_random_uuid(), tst.sha('w2')) ->> 'error' = 'reservations_closed');
select tst.ok('W2 reservations closed: an upload already reserved can still finish',
  tst.svc('finish', jsonb_build_object('user_id', :B, 'id', (select tst.id(v) from j where k='w1'))) ->> 'status' = 'done');
update private.settings set value = 'true' where key = 'reservations_open';
insert into j select 'w3', tst.reserve(:B, gen_random_uuid(), tst.sha('w3'), 1200);
select tst.put(tst.path((select tst.id(v) from j where k='w3')), 1200);
update private.settings set value = 'true' where key = 'emergency_stop';
select tst.ok('W3 emergency stop: begin refused', tst.reserve(:B, gen_random_uuid(), tst.sha('w4')) ->> 'error' = 'stopped');
select tst.ok('W4 emergency stop: finish refused', tst.svc('finish', jsonb_build_object('user_id', :B, 'id', (select tst.id(v) from j where k='w3'))) ->> 'error' = 'stopped');
select tst.ok('W5 emergency stop: download still works',
  tst.svc('ready_item', jsonb_build_object('user_id', :B, 'id', (select tst.id(v) from j where k='w1'))) ? 'path');
select tst.act('authenticated', :B);
select tst.ok('W6 emergency stop: delete still works', public.library_delete((select tst.id(v) from j where k='w1')) = 'deleting');
select tst.ok('W7 emergency stop: usage reports uploads closed', (public.library_usage() ->> 'uploads_open')::boolean = false);
select tst.back();
select tst.ok('W8 emergency stop: janitor still works',
  jsonb_typeof(tst.svc('due_purges', '{}')) = 'array' and jsonb_typeof(tst.svc('expired', '{}')) = 'array');
update private.settings set value = 'false' where key = 'emergency_stop';

-- ===================================================================== O. orphans, audit, tombstones, lease
select tst.put(:A || '/' || gen_random_uuid() || '.mp3', 100, 'audio/mpeg', '2 hours');
select tst.put(:A || '/' || gen_random_uuid() || '.mp3', 100, 'audio/mpeg', '5 minutes');
select tst.ok('O1 orphans: only objects older than 1 hour with no live row',
  jsonb_array_length(tst.svc('orphans', '{}')) = 1);
select tst.ok('O2 objects of live rows are never orphans',
  not exists (select 1 from jsonb_array_elements_text(tst.svc('orphans', '{}')) o
               join public.library_items li on li.storage_path = o and li.state <> 'purged'));
update private.library_usage set items_active = items_active + 7, bytes_active = 1 where user_id = :A;
select tst.ok('O3 audit detects and repairs drift', tst.svc('audit_user', jsonb_build_object('user_id', :A)) = 'true'::jsonb
  and tst.svc('audit_user', jsonb_build_object('user_id', :A)) = 'false'::jsonb);
select tst.ok('O4 audit never lowers releasing below what is still stored (orphan bytes kept counted)',
  (tst.usage(:A) ->> 'bytes_releasing')::bigint >= 200);
update public.library_items set purged_at = now() - interval '31 days' where state = 'purged' and user_id = :A;
select tst.ok('O5 tombstones older than 30 days are dropped', (tst.svc('drop_tombstones', '{}'))::int >= 3);
select tst.ok('O6 janitor lease is exclusive',
  tst.svc('janitor_acquire', '{"holder":"h1","secs":60}') = 'true'::jsonb
  and tst.svc('janitor_acquire', '{"holder":"h2","secs":60}') = 'false'::jsonb);
select tst.svc('janitor_release', '{"holder":"h1"}');
select tst.ok('O7 lease released', tst.svc('janitor_acquire', '{"holder":"h2","secs":60}') = 'true'::jsonb);
select tst.ok('O8 unknown op rejected', tst.err($$select tst.svc('drop_everything', '{}')$$) like '22023%');
select tst.ok('O9 health view readable by the owner', (select stored_bytes >= 0 from private.library_health));

-- ===================================================================== M. misc
select tst.ok('M1 names are cleaned (control chars removed, 80 chars max, empty → SnipRing)',
  private.clean_name(E'a\tb\u0001c') = 'abc' and char_length(private.clean_name(repeat('א', 200))) = 80
  and private.clean_name('   ') = 'SnipRing' and private.clean_name(null) = 'SnipRing');
select tst.ok('M2 an auth user with library data cannot be deleted by accident (FK restrict)',
  tst.err($$delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1'$$) like '23503%');
select tst.ok('M3 user without library data can still be deleted', tst.err($$delete from auth.users where id = '00000000-0000-0000-0000-0000000000c3'$$) = '');

-- ===================================================================== final invariant: counters == rows for every user
select tst.ok('Z1 every user''s counters match their rows after the whole run',
  not exists (select 1 from private.library_usage u
               where row(u.items_active, u.bytes_active, u.uploading_count) is distinct from
                     (select row(count(*) filter (where state in ('uploading','ready'))::int,
                                 coalesce(sum(size_bytes) filter (where state in ('uploading','ready')), 0)::bigint,
                                 count(*) filter (where state = 'uploading')::int)
                        from public.library_items li where li.user_id = u.user_id)));

\o
\set QUIET 0
\pset footer off
select n, case when ok then 'PASS' else 'FAIL' end as result, name, info from tst.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tst.results;
do $$ begin
  if exists (select 1 from tst.results where not ok) then raise exception 'library_1b tests FAILED'; end if;
end $$;

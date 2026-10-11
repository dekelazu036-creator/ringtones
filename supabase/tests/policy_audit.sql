-- =====================================================================
-- READ-ONLY policy & privilege audit (T26). Safe on staging; on production only with the owner's OK.
-- It changes nothing. Every row is something an API role can do; compare with the expected list
-- at the bottom. Anything not on that list blocks the release.
-- =====================================================================
select 'policy' as kind, schemaname || '.' || tablename as object, policyname as detail,
       array_to_string(roles, ',') as who, cmd as what
  from pg_policies where schemaname in ('public', 'storage', 'private')
union all
select 'table_grant', table_schema || '.' || table_name, privilege_type, grantee, null
  from information_schema.role_table_grants
 where table_schema in ('public', 'private', 'storage') and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
union all
select 'column_grant', table_schema || '.' || table_name, column_name || ':' || privilege_type, grantee, null
  from information_schema.column_privileges
 where table_schema in ('public', 'private') and table_name = 'library_items'
   and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
union all
select 'execute', n.nspname || '.' || p.oid::regprocedure::text,
       case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end, r, null
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       unnest(array['anon', 'authenticated', 'service_role']) r
 where n.nspname in ('public', 'private') and has_function_privilege(r, p.oid, 'execute')
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all
select 'definer_without_search_path', n.nspname || '.' || p.oid::regprocedure::text, '', '', null
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'private') and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
union all
select 'schema_usage', s, '', r, null
  from unnest(array['private']) s, unnest(array['anon', 'authenticated', 'service_role']) r
 where has_schema_privilege(r, s, 'usage')
union all
select 'bucket', id, case when public then 'PUBLIC' else 'private' end,
       coalesce(file_size_limit::text, 'no limit'), array_to_string(allowed_mime_types, ',')
  from storage.buckets
union all
select 'rls_off', n.nspname || '.' || c.relname, '', '', null
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity
order by 1, 2, 4;

-- EXPECTED for Phase 1B (anything else = stop and review):
--  policy      public.library_items "own ready items" (authenticated, SELECT)
--  policy      public.profiles "own profile readable" / "own profile editable" (authenticated)
--  policy      public.sounds/packs/pack_items read-only (anon, authenticated); favorites own; reports insert
--  policy      storage.*: NONE that mention user-media or apply to every bucket
--  column_grant library_items: authenticated SELECT on id,name,type,duration_ms,size_bytes,origin,created_at only
--  execute     anon: bump_sound, search_sounds, trending_sounds (+ auth.* helpers)
--  execute     authenticated: + library_delete, library_job_status, library_usage
--  execute     service_role: + svc_library
--  definer_without_search_path: NONE      schema_usage private: NONE      rls_off: NONE
--  bucket      user-media private, 10485760, audio/mpeg

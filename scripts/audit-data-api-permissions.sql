-- Read-only catalog audit; no trip, account or credential data is read.
select
  n.nspname as schema_name,
  c.relname as table_name,
  pg_get_userbyid(c.relowner) as table_owner,
  c.relrowsecurity as rls_enabled,
  array(select acl.privilege_type from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0 order by acl.privilege_type) as public_table_privileges,
  has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') as anon_any_column_access,
  has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') as authenticated_any_column_access,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_read,
  has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
  has_table_privilege('anon', c.oid, 'TRUNCATE') as anon_truncate,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_read,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete,
  has_table_privilege('authenticated', c.oid, 'TRUNCATE') as authenticated_truncate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relrowsecurity, c.relname;

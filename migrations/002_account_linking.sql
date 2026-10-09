create table oauth_connections (
  owner_id uuid not null, client_id text not null, client_name text not null,
  grant_version uuid not null, updated_at timestamptz not null default now(),
  primary key(owner_id, client_id),
  foreign key(owner_id, client_id) references client_grants(owner_id, client_id)
);
create table oauth_consent_requests (
  id uuid primary key, owner_id uuid not null, authorization_id text not null,
  client_id text not null, client_name text not null, redirect_uri text not null,
  expires_at timestamptz not null, consumed_at timestamptz
);
create index oauth_consent_expiry on oauth_consent_requests(expires_at);
create table oauth_resource (
  singleton boolean primary key default true check(singleton), audience text not null
);
alter table oauth_connections enable row level security;
alter table oauth_consent_requests enable row level security;
alter table oauth_resource enable row level security;
revoke all on oauth_connections,oauth_consent_requests,oauth_resource from public;

-- Enable this hook separately in Supabase Auth after reviewing the consent UI.
-- Only Supabase Auth may invoke it; browser/assistant tokens cannot mint claims.
create function public.travel_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  claims jsonb := event->'claims';
  client text := coalesce(event->>'client_id', event->'claims'->>'client_id');
  version uuid;
  audience text;
begin
  claims := claims - 'travel_grant_version';
  if client is not null then
    select c.grant_version, r.audience into version, audience
      from public.oauth_connections c
      join public.client_grants g using(owner_id,client_id)
      cross join public.oauth_resource r
      where c.owner_id=(claims->>'sub')::uuid and c.client_id=client
        and g.revoked_at is null and 'read'=any(g.permissions);
    if version is not null then
      claims := jsonb_set(claims, '{aud}', to_jsonb(audience));
      claims := jsonb_set(claims, '{client_id}', to_jsonb(client));
      claims := jsonb_set(claims, '{travel_grant_version}', to_jsonb(version::text));
    end if;
  end if;
  return jsonb_build_object('claims',claims);
end;
$$;
revoke all on function public.travel_access_token_hook(jsonb) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on oauth_connections,oauth_consent_requests,oauth_resource from anon;
    revoke all on function public.travel_access_token_hook(jsonb) from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on oauth_connections,oauth_consent_requests,oauth_resource from authenticated;
    revoke all on function public.travel_access_token_hook(jsonb) from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.travel_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end $$;

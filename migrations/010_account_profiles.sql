create table account_profiles (
  user_id uuid primary key,
  handle text unique check(handle ~ '^[a-z][a-z0-9_]{2,23}$'),
  display_name text not null default '' check(length(display_name)<=60),
  avatar_bytes bytea check(octet_length(avatar_bytes)<=24576),
  avatar_version uuid,
  revision integer not null default 0 check(revision>=0),
  updated_at timestamptz not null default now(),
  check((avatar_bytes is null)=(avatar_version is null))
);
alter table account_profiles enable row level security;
revoke all on account_profiles from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on account_profiles from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on account_profiles from authenticated; end if;
end $$;

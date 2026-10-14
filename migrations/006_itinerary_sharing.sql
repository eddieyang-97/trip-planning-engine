create table itinerary_invites (
  id uuid primary key, trip_id uuid not null references trips(id), token_hash text not null unique,
  label text not null check(length(label)<=80), created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_by uuid, accepted_at timestamptz, revoked_at timestamptz,
  unique(id,trip_id), check((accepted_by is null)=(accepted_at is null))
);
create index itinerary_invites_trip on itinerary_invites(trip_id);
create table itinerary_members (
  id uuid primary key, trip_id uuid not null references trips(id), user_id uuid not null,
  display_name text not null check(length(display_name) between 1 and 60),
  role text not null default 'viewer' check(role='viewer'),
  invite_id uuid not null, joined_at timestamptz not null default now(), revoked_at timestamptz,
  unique(trip_id,user_id), foreign key(invite_id,trip_id) references itinerary_invites(id,trip_id)
);
create index itinerary_members_user on itinerary_members(user_id,trip_id) where revoked_at is null;
alter table itinerary_invites enable row level security;
alter table itinerary_members enable row level security;
revoke all on itinerary_invites,itinerary_members from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on itinerary_invites,itinerary_members from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on itinerary_invites,itinerary_members from authenticated;
  end if;
end $$;

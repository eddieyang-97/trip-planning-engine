create table trip_travelers (
  id uuid primary key,
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index trip_travelers_trip on trip_travelers(trip_id,created_at,id);

alter table trip_travelers enable row level security;
revoke all on trip_travelers from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on trip_travelers from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on trip_travelers from authenticated;
  end if;
end $$;

alter table itinerary_events drop constraint itinerary_events_action_check;
alter table itinerary_events add constraint itinerary_events_action_check
  check(action in ('added','edited','removed','moved','traveler_added','traveler_renamed','traveler_archived','traveler_restored'));

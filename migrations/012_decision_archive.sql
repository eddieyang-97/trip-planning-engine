-- Visibility only: existing evidence, bookings and supplier accounting are unchanged.
alter table decisions add column archived_at timestamptz;
alter table decisions add column archived_by uuid;
alter table decisions add constraint decision_archive_actor check((archived_at is null)=(archived_by is null));
create table decision_lifecycle_events(
  decision_id uuid not null references decisions(id) on delete cascade,
  revision integer not null check(revision>0),actor_id uuid not null,
  action text not null check(action in ('archive','restore')),created_at timestamptz not null default now(),
  primary key(decision_id,revision)
);
alter table decision_lifecycle_events enable row level security;
revoke all on decision_lifecycle_events from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on decision_lifecycle_events from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on decision_lifecycle_events from authenticated; end if;
end $$;

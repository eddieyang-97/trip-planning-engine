create table trip_expense_events (
  trip_id uuid not null references trips(id) on delete cascade,
  revision integer not null check (revision > 0),
  expense_id uuid not null,
  actor_id uuid not null,
  action text not null check (action in ('recorded','corrected','voided')),
  currency text not null check (currency = 'GBP'),
  amount_minor integer not null check (amount_minor between 1 and 100000000),
  detail jsonb not null,
  created_at timestamptz not null default now(),
  primary key (trip_id,revision)
);
create index trip_expense_events_current on trip_expense_events(trip_id,expense_id,revision desc);

alter table trip_expense_events enable row level security;
revoke all on trip_expense_events from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on trip_expense_events from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on trip_expense_events from authenticated;
  end if;
end $$;

create table policy_notes (
  id uuid primary key, owner_id uuid not null,
  current_version integer not null default 1 check(current_version>0),
  created_at timestamptz not null default now()
);
create index policy_notes_owner on policy_notes(owner_id);
create table policy_note_versions (
  note_id uuid not null references policy_notes(id),
  version integer not null check(version>0), payload jsonb not null,
  created_at timestamptz not null default now(), primary key(note_id,version)
);
create table selection_policy_notes (
  selection_id uuid not null references selections(id),
  note_id uuid not null, version integer not null,
  primary key(selection_id,note_id),
  foreign key(note_id,version) references policy_note_versions(note_id,version)
);
alter table policy_notes enable row level security;
alter table policy_note_versions enable row level security;
alter table selection_policy_notes enable row level security;
revoke all on policy_notes,policy_note_versions,selection_policy_notes from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on policy_notes,policy_note_versions,selection_policy_notes from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on policy_notes,policy_note_versions,selection_policy_notes from authenticated;
  end if;
end $$;

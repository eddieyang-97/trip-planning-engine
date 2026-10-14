# Database ER diagrams

Updated 14 October 2026. These diagrams describe the recorded deployed schema, migrations **001–006**, including the viewer-sharing extension below. Start with the [high-level architecture](architecture.md#high-level-architecture), then use the diagrams below for relationships and keys. See [user flows](user-flows.md) for how people use the model.

Entity names match SQL table names, shown in uppercase for readability. Attributes are selected fields, not complete DDL. `PK` marks a primary-key component; `FK` marks a foreign-key component. Solid lines identify a child through its parent key; dashed lines are non-identifying relationships. Both represent enforced foreign keys here; dashed does **not** mean planned. A circle allows zero, a bar means one, and a crow's foot means many. See [Mermaid's notation reference](https://mermaid.js.org/syntax/entityRelationshipDiagram.html).

## Flight research and outcomes

Sources: [migration 001](../migrations/001_initial.sql) and [migration 005](../migrations/005_live_search.sql).

```mermaid
erDiagram
    TRIPS ||..o{ DECISIONS : contains
    DECISIONS ||--o{ CRITERIA_VERSIONS : versions
    DECISIONS ||..o{ CANDIDATES : considers
    DECISIONS ||..o{ SEARCH_RUNS : searches
    CRITERIA_VERSIONS ||..o{ SEARCH_RUNS : freezes
    CANDIDATES ||..o{ OBSERVATIONS : has_evidence
    SEARCH_RUNS |o..o{ OBSERVATIONS : produces
    SEARCH_RUNS ||--o{ PROVIDER_ATTEMPTS : executes
    OBSERVATIONS ||..o{ SELECTIONS : supports
    CRITERIA_VERSIONS ||..o{ SELECTIONS : evaluates_under
    SELECTIONS ||..o{ BOOKING_RECORDS : records_outcome

    TRIPS {
        uuid id PK
        uuid owner_id
        jsonb payload
        integer itinerary_revision
    }
    DECISIONS {
        uuid id PK
        uuid trip_id FK
        text title
        integer revision
    }
    CRITERIA_VERSIONS {
        uuid decision_id PK, FK
        integer version PK
        jsonb payload
    }
    CANDIDATES {
        uuid id PK
        uuid decision_id FK
        text identity_key
        text disposition
    }
    SEARCH_RUNS {
        uuid id PK
        uuid decision_id FK
        integer criteria_version FK
        text provider
        text status
        integer reserved_requests
    }
    OBSERVATIONS {
        uuid id PK
        uuid decision_id FK
        uuid candidate_id FK
        uuid run_id FK "nullable for manual evidence"
        text provenance
        jsonb payload
    }
    PROVIDER_ATTEMPTS {
        uuid run_id PK, FK
        integer attempt PK
        text stage
        text status
        timestamptz reserved_at
    }
    SELECTIONS {
        uuid id PK
        uuid decision_id FK
        uuid observation_id FK
        integer criteria_version FK
        jsonb evaluation
        timestamptz superseded_at "nullable for active selection"
    }
    BOOKING_RECORDS {
        uuid id PK
        uuid selection_id FK
        timestamptz booked_at
        text status
        text note
    }
```

A candidate is the stable flight pair; each observation is a separate dated seller/fare/price report. A run references one immutable criteria version. Manual observations have no run. Composite foreign keys carry `decision_id` alongside candidate, run, observation and criteria references, preventing cross-decision evidence links.

Selections pin exact evidence and evaluation. There can be many historical selections, but a partial unique index allows only one unsuperseded selection per decision. A booking record is a separate user report, not a supplier transaction. The live run reserves request allowance; its attempts preserve stages and uncertain outcomes independently of the offer payload.

## Itinerary and history

Source: [migration 004](../migrations/004_itinerary.sql).

```mermaid
erDiagram
    TRIPS ||..o{ ITINERARY_ITEMS : organizes
    TRIPS ||..o{ ITINERARY_EVENTS : records_history
    ITINERARY_ITEMS |o..o{ ITINERARY_EVENTS : concerns

    TRIPS {
        uuid id PK
        uuid owner_id
        integer itinerary_revision
    }
    ITINERARY_ITEMS {
        uuid id PK
        uuid trip_id FK
        jsonb payload
        integer position
        timestamptz removed_at "soft removal"
    }
    ITINERARY_EVENTS {
        uuid id PK
        uuid trip_id FK
        uuid item_id FK "nullable"
        uuid actor_id
        text action
        integer revision
        jsonb before_payload
        jsonb after_payload
    }
```

The trip revision serializes plan changes; item ordering and optional local dates/times live in the current plan. Removal hides an item while preserving its row and history. `actor_id` records the authenticated account; it is not a foreign key to a local users table.

There is **no persistent foreign key from an itinerary item to a research observation or selection** in this release. The web page reads research from the trip's decisions and can prepare a tentative manual snapshot. A source URL or copied note is not a durable research link, and subsequent searches do not update the manual item automatically.

## Assistant grants and private policy references

Sources: [migration 002](../migrations/002_account_linking.sql) and [migration 003](../migrations/003_policy_notes.sql), with grants introduced in migration 001.

```mermaid
erDiagram
    CLIENT_GRANTS ||--o| OAUTH_CONNECTIONS : binds_client
    POLICY_NOTES ||--o{ POLICY_NOTE_VERSIONS : versions
    SELECTIONS ||--o{ SELECTION_POLICY_NOTES : pins
    POLICY_NOTE_VERSIONS ||--o{ SELECTION_POLICY_NOTES : referenced_by

    CLIENT_GRANTS {
        uuid owner_id PK
        text client_id PK
        text[] permissions
        timestamptz revoked_at
    }
    OAUTH_CONNECTIONS {
        uuid owner_id PK, FK
        text client_id PK, FK
        text client_name
        uuid grant_version
    }
    POLICY_NOTES {
        uuid id PK
        uuid owner_id
        integer current_version
    }
    POLICY_NOTE_VERSIONS {
        uuid note_id PK, FK
        integer version PK
        jsonb payload
    }
    SELECTIONS {
        uuid id PK
    }
    SELECTION_POLICY_NOTES {
        uuid selection_id PK, FK
        uuid note_id PK, FK
        integer version FK
    }
```

The grant and OAuth connection share `(owner_id, client_id)`. A local-development grant can exist without an OAuth connection. Version rotation invalidates earlier assistant tokens; revocation removes application access without waiting for token expiry.

Private policy notes belong to an account and may be reused across its trips. Selection references pin `(note_id, version)`; they never supply missing quote costs or verify equipment carriage. `current_version` is managed transactionally by the application, rather than enforced through a separate current-version foreign key.

## Account ownership and supporting tables

Supabase Auth manages accounts outside this application schema. `owner_id`, `actor_id`, `requested_by`, and similar UUID fields are verified account references used by the service; migrations 001–006 do **not** create an application users table or SQL foreign keys to `auth.users`. Ownership checks and direct/assistant session rules remain essential. The browser does not read these tables through the Supabase Data API.

These supporting tables have no application-table foreign keys, so they are listed separately rather than shown with invented relationships:

| Table | Key | Role |
| --- | --- | --- |
| `oauth_consent_requests` | `id` | Bound, expiring authorization request; client/account/redirect data and consumption time |
| `oauth_resource` | `singleton` | One configured resource audience used by the token hook |
| `mutation_requests` | `(owner_id, operation, key)` | Request hash and original response for idempotent retries |
| `app_schema_migrations` | `version` | Migration metadata created by [database.ts](../src/database.ts) |

The three ER diagrams above and this table cover twenty application/metadata tables; the viewer-sharing diagram below adds two more for twenty-two in the recorded release. JSONB fields hold validated snapshots; this is not the larger [historical schema proposal](spike/design/schema.sql).

## Viewer sharing extension — deployed

Source: [migration 006](../migrations/006_itinerary_sharing.sql), deployed with `f6f1670` on 14 October. See [sharing acceptance and limits](itinerary-sharing.md): email delivery and a real friend session remain pending. It adds viewer access; comments, collaborator proposals and approval tables are not part of this migration.

```mermaid
erDiagram
    TRIPS ||..o{ ITINERARY_INVITES : issues
    TRIPS ||..o{ ITINERARY_MEMBERS : shares_with
    ITINERARY_INVITES ||..o{ ITINERARY_MEMBERS : grants_access

    TRIPS {
        uuid id PK
        uuid owner_id
    }
    ITINERARY_INVITES {
        uuid id PK
        uuid trip_id FK
        text token_hash UK
        timestamptz expires_at
        uuid accepted_by "nullable"
        timestamptz revoked_at
    }
    ITINERARY_MEMBERS {
        uuid id PK
        uuid trip_id FK
        uuid user_id
        text role "viewer only in this migration"
        uuid invite_id FK
        timestamptz revoked_at
    }
```

`UK` marks a unique value. Membership is unique by `(trip_id, user_id)`, and the composite invite/trip foreign key keeps access bound to the same trip. The SQL schema permits multiple member rows referencing an invite; the current application redemption rules bind an invitation to one accepting account. The owner remains `trips.owner_id`, not an extra membership row. Further collaboration roles and discussion remain product targets, shown in [user flows](user-flows.md#collaborator-proposal-and-approval--target-flow).

Update the relevant ER diagram when an applied migration changes relationships. Keep local/proposed extensions labelled until deployment and acceptance evidence are recorded.

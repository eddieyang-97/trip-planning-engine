# User flow diagrams

Updated 14 October 2026. The diagrams describe the recorded deployed release unless marked **work in progress** or **target flow**. Implementation does not imply that every end-to-end acceptance step has been verified. See [architecture](architecture.md), [database ER diagrams](database.md) and [delivery evidence](implementation.md).

## Sign in and connect an assistant

Web and MCP use the same account, with different session/permission boundaries. Initial direct sign-in and official-SDK OAuth passed; ChatGPT linking/retrieval has recorded proof. Other-assistant and refresh/revocation acceptance remain separate.

```mermaid
flowchart TB
    Start[Use the trip workspace] --> Surface{Choose a surface}
    Surface -->|Web| WebSign[Sign in to the travel account]
    WebSign --> WebTrip[Open the private itinerary and saved research]
    Surface -->|Assistant| Connect[Connect the hosted MCP server]
    Connect --> Account[Sign in to the same travel account]
    Account --> Consent[Review client and read / write / search permissions]
    Consent --> Approve{Approve connection?}
    Approve -->|No| Denied[Connection is not authorized]
    Approve -->|Yes| Tokens[OAuth completes with a client-bound token]
    Tokens --> Tools[Assistant uses tools within approved permissions]
    WebTrip --> Same[Same saved account and trip state]
    Tools --> Same
```

Web sign-in does not grant an assistant access. Assistant tokens cannot manage account connections; the user manages consent/revocation through the account page. Identity scopes and application permissions are separate. See [account linking](account-linking.md).

## Research flights through an assistant

The current search entry point is MCP. The web app can read saved research and prepare itinerary drafts, but direct web search/comparison/outcome controls remain further delivery work. The pilot covers one direct Gatwick–Geneva pair and up to ten sellers.

```mermaid
flowchart TB
    Trip[Create or retrieve the trip] --> Criteria[Review requirements and explicit assumptions]
    Criteria --> Search[Explicitly request a live search]
    Search --> Checks{Scope, permissions, revision and allowance valid?}
    Checks -->|No| Explain[Show the failure; no new supplier request]
    Explain --> Criteria
    Checks -->|Yes| Run[Save a run and reserve its request allowance]
    Run --> Poll[Return run ID; poll saved status]
    Poll --> Result{Run outcome}
    Result -->|Complete| Evidence[Review seller observations, coverage and unknowns]
    Result -->|Failed or outcome unknown| Failure[Inspect saved status; retry requires an explicit new run]
    Evidence --> Compare[Compare against the saved criteria]
    Compare --> Choice[Save, reject, or select with a rationale]
    Choice --> Revisit[Retrieve later; explicitly recheck if needed]
    Revisit --> Criteria
```

The runner performs bounded supplier stages after admission. Repeating an identical mutation returns the original run; polling or retrieving saved research does not initiate a new search. The failure branch does not instruct the user to retry a new run blindly: inspect ambiguous outcomes and available allowance first. See [pilot execution/recovery](hosted-live-search.md#persistence-cost-and-recovery).

Known hard-constraint failures block selection; unresolved conditions require explicit acknowledgment. Selection is not a booking. The user may book outside the product and separately record that report through MCP; no ticket purchase or reservation is performed by this service.

## Organize the itinerary and continue across surfaces

Manual item writes are implemented in both surfaces. Saved-flight review prepares a draft in the web app. Real hosted research reads agree; a complete hosted manual edit round trip remains an acceptance gap.

```mermaid
flowchart TB
    Open[Open the same trip through web or MCP] --> Read[Read the current plan and revision]
    Read --> Manual[Add or edit a manual item]
    Read --> Research[Review a saved flight in the web app]
    Research --> Draft[Prepare a tentative manual draft]
    Draft --> Review[Review dates, local times, source and open questions]
    Manual --> Review
    Review --> Save{Save the change?}
    Save -->|No| Cancel[Discard draft; saved plan is unchanged]
    Save -->|Yes| Revision{Revision still current?}
    Revision -->|No| Reload[Reload and review the current plan]
    Reload --> Read
    Revision -->|Yes| Persist[Save item and history; increment revision]
    Persist --> Other[Reload through either surface to see the same plan]
```

A copied research draft remains tentative and never creates a research selection or booking. A matching existing flight opens for editing rather than automatically adding another copy. The saved manual item is a snapshot; new research does not update it automatically. Booked labels require an explicit user report and booking note. See [itinerary behavior](itinerary-web.md).

## Viewer invitation — work in progress

This flow describes the local viewer-sharing extension in migration 006, not deployed acceptance. Invitation management is through the direct-session web surface. The local read projection excludes research, owner history and booking notes for viewers.

```mermaid
flowchart TB
    Owner[Organizer opens trip access controls] --> Invite[Create an expiring viewer invitation]
    Invite --> Share[Organizer shares the private link]
    Share --> Friend[Friend opens link and signs in]
    Friend --> Valid{Invitation valid for this account?}
    Valid -->|No| Unavailable[Show unavailable, expired or revoked]
    Valid -->|Yes| Join[Review invitation and accept as a viewer]
    Join --> Member[Persist membership for the signed-in account]
    Member --> View[Read the shared manual itinerary]
    View --> ReadOnly[Viewer cannot change the plan]
    Owner --> Revoke[Revoke the invitation and linked access]
    Revoke --> Block[Later shared reads are denied]
```

An invitation URL is a route to authenticated membership, not anonymous publication. It does not grant access to the owner's account-private research or assistant connections. Source: [local sharing implementation](../src/itinerary-sharing.ts) and [ER extension](database.md#viewer-sharing-extension--work-in-progress).

## Collaborator proposal and approval — target flow

This is the agreed product direction from the PRD. It is not implemented by the viewer-only migration. Collaborators can discuss and propose; only the organizer changes the agreed plan. Comments/proposals do not constitute a booking.

```mermaid
flowchart TB
    Collaborator[Authenticated collaborator reviews an item] --> Discuss[Discuss the item or trip]
    Discuss --> Propose[Propose addition, edit or removal]
    Propose --> Pending[Keep proposal pending; agreed plan stays unchanged]
    Pending --> Organizer[Organizer reviews proposal and open conditions]
    Organizer --> Decision{Accept proposal?}
    Decision -->|No| Decline[Record decline; keep the plan]
    Decision -->|Yes| Current{Target revision still current?}
    Current -->|No| Conflict[Review proposal against the changed plan]
    Conflict --> Organizer
    Current -->|Yes| Apply[Apply approved change and record proposal / approval history]
    Apply --> Shared[Everyone reloads the agreed plan]
```

Role enforcement, revocation, proposal conflicts, shared history and booking-detail visibility need implementation and real collaboration acceptance. See [the collaboration requirements](prd.md#itinerary-foundation-and-collaboration).

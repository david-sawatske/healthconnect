# Advocate Invite Approval Flow

This diagram shows how HealthConnect handles Advocate access through an invite and approval workflow.

The workflow separates a requested Advocate relationship from an approved Advocate assignment. This helps prevent Providers from directly granting Advocate access without Patient approval.

```mermaid
sequenceDiagram
  autonumber

  actor Provider as Provider
  actor Patient as Patient
  participant ProviderUI as Provider Screen
  participant PatientUI as Patient Invite Approval Screen
  participant AppSync as AppSync GraphQL API
  participant InviteGuard as createAdvocateInviteGuarded Lambda
  participant ApproveLambda as approveInvite Lambda
  participant InviteTable as AdvocateInvite Table
  participant AssignmentTable as AdvocateAssignment Table
  participant ConversationTable as Conversation Table
  participant ParticipantTable as ConversationParticipant Table
  participant MessageTable as Message Table
  participant CloudWatch as CloudWatch Logs

  Provider->>ProviderUI: Select Patient and Advocate
  ProviderUI->>AppSync: Request Advocate invite creation
  AppSync->>InviteGuard: Invoke guarded invite workflow

  InviteGuard->>InviteGuard: Validate Provider access to Patient
  InviteGuard->>InviteGuard: Validate Advocate target
  InviteGuard->>ConversationTable: Check CARE_TEAM:${patientId}:${providerId}
  ConversationTable-->>InviteGuard: Return care-team conversation

  InviteGuard->>InviteTable: Check for existing active invite
  InviteGuard->>AssignmentTable: Check for existing approved assignment
  InviteGuard->>ParticipantTable: Check if Advocate is already a participant

  alt Existing assignment or membership found
    InviteGuard-->>AppSync: Return duplicate-prevention response
    AppSync-->>ProviderUI: Show already connected / already invited state
  else No duplicate relationship exists
    InviteGuard->>InviteTable: Create AdvocateInvite with PENDING status
    InviteTable-->>InviteGuard: Return created invite
    InviteGuard->>CloudWatch: Log invite creation
    InviteGuard-->>AppSync: Return pending invite
    AppSync-->>ProviderUI: Show invite pending
  end

  Patient->>PatientUI: Review pending Advocate invite

  alt Patient declines invite
    PatientUI->>AppSync: DeclineAdvocateInvite mutation
    AppSync->>InviteTable: Update invite status to DECLINED
    InviteTable-->>AppSync: Return declined invite
    AppSync-->>PatientUI: Show declined state
  else Patient approves invite
    PatientUI->>AppSync: ApproveInviteServer mutation
    AppSync->>ApproveLambda: Invoke approval workflow

    ApproveLambda->>InviteTable: Load AdvocateInvite
    InviteTable-->>ApproveLambda: Return invite

    ApproveLambda->>ApproveLambda: Validate invite is PENDING
    ApproveLambda->>ApproveLambda: Validate approving Patient owns invite

    ApproveLambda->>AssignmentTable: Check PA:${patientId}:PR:${providerId}:ADV:${advocateId}

    alt Assignment already exists or invite already processed
      ApproveLambda-->>AppSync: Return duplicate-prevention response
      AppSync-->>PatientUI: Show already approved / already processed state
    else Invite can be approved
      ApproveLambda->>AssignmentTable: Create AdvocateAssignment
      AssignmentTable-->>ApproveLambda: Return assignment

      ApproveLambda->>ConversationTable: Load CARE_TEAM:${patientId}:${providerId}
      ConversationTable-->>ApproveLambda: Return care-team conversation

      ApproveLambda->>ConversationTable: Add advocateId to memberIds
      ConversationTable-->>ApproveLambda: Return updated conversation

      ApproveLambda->>ParticipantTable: Ensure ${conversationId}:${advocateId}
      ParticipantTable-->>ApproveLambda: Created or reused participant

      ApproveLambda->>MessageTable: Write SYSTEM message for approval event
      MessageTable-->>ApproveLambda: Return system message

      ApproveLambda->>InviteTable: Update invite status to APPROVED
      InviteTable-->>ApproveLambda: Return approved invite

      ApproveLambda->>CloudWatch: Log approval workflow result
      ApproveLambda-->>AppSync: Return approved invite result
      AppSync-->>PatientUI: Show approved state
    end
  end
```

## Records involved in this flow

The Advocate invite approval workflow uses these records:

```txt
Care-team conversation:
CARE_TEAM:${patientId}:${providerId}

Advocate assignment:
PA:${patientId}:PR:${providerId}:ADV:${advocateId}

Advocate participant:
${conversationId}:${advocateId}
```

## Invite status lifecycle

An Advocate invite starts as:

```txt
PENDING
```

Then it can become:

```txt
APPROVED
```

or:

```txt
DECLINED
```

Only approved invites should create an `AdvocateAssignment` and add the Advocate to the care-team conversation.

## Why this matters

This flow demonstrates several senior-level engineering decisions:

- **Invite and assignment are separate concepts**, which keeps pending access requests distinct from approved access.
- **Patient approval controls Advocate access**, preventing Providers from directly granting full care-team access on their own.
- **Duplicate approval is guarded server-side**, so repeated approval attempts do not create duplicate assignments or participants.
- **Care-team membership is updated as part of the backend approval workflow**, keeping access changes centralized and consistent.
- **ConversationParticipant rows are explicitly created or reused**, making conversation access easier to reason about.
- **A system message records the approval event in the conversation timeline**, improving visibility for demo users.
- **Backend Lambdas own multi-table workflow logic**, instead of requiring the frontend to coordinate several dependent writes.

## Important limitations and demo assumptions

HealthConnect is a portfolio/demo app and not a production healthcare access-control system.

Current limitations and assumptions include:

- The project is not HIPAA-compliant.
- The workflow demonstrates production-style authorization thinking but would need deeper audit logging, compliance review, and access-control hardening for real healthcare use.
- The approval flow is intentionally scoped to Patient / Provider / Advocate relationships in the demo app.
- The diagram does not show every UI loading, error, or retry state.
- Production systems would need stronger transaction guarantees, structured audit records, monitoring, alerting, and operational runbooks.
- System messages improve conversation visibility but are not a substitute for a production audit log.

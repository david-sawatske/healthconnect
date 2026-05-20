# Admin Relationship Creation Flow

This diagram shows how HealthConnect handles Admin-created Patient / Provider relationships.

The Admin workflow is intentionally backend-owned so repeated actions can safely reuse existing records instead of creating duplicate relationships or duplicate care-team conversations.

```mermaid
sequenceDiagram
  autonumber

  actor Admin as Admin
  participant AdminUI as Admin Screen
  participant RestAPI as API Gateway REST API
  participant AdminLambda as adminManageUsers Lambda
  participant Cognito as Cognito User Pool
  participant UserTable as User Table
  participant ProviderPatientTable as ProviderPatient Table
  participant ConversationTable as Conversation Table
  participant ParticipantTable as ConversationParticipant Table
  participant CloudWatch as CloudWatch Logs

  Admin->>AdminUI: Select or create users

  opt Create app user
    AdminUI->>RestAPI: POST /admin/users CREATE_USER
    RestAPI->>AdminLambda: Invoke admin workflow
    AdminLambda->>AdminLambda: Validate Admin permissions
    AdminLambda->>AdminLambda: Validate role, name, and email
    AdminLambda->>Cognito: Create or reuse Cognito user
    Cognito-->>AdminLambda: Return Cognito user sub
    AdminLambda->>UserTable: Create or update app User row
    UserTable-->>AdminLambda: Return User record
    AdminLambda->>CloudWatch: Log workflow result
    AdminLambda-->>RestAPI: Return created or reused user
    RestAPI-->>AdminUI: Show result
  end

  Admin->>AdminUI: Connect Patient and Provider
  AdminUI->>RestAPI: POST /admin/users CONNECT_PATIENT_PROVIDER
  RestAPI->>AdminLambda: Invoke relationship workflow

  AdminLambda->>AdminLambda: Validate Admin permissions
  AdminLambda->>AdminLambda: Validate patientId and providerId

  AdminLambda->>ProviderPatientTable: Check PP:${providerId}:${patientId}

  alt ProviderPatient exists
    ProviderPatientTable-->>AdminLambda: Return existing relationship
    AdminLambda->>AdminLambda: Mark relationship as reused
  else ProviderPatient does not exist
    AdminLambda->>ProviderPatientTable: Create ProviderPatient row
    ProviderPatientTable-->>AdminLambda: Return created relationship
  end

  AdminLambda->>ConversationTable: Check CARE_TEAM:${patientId}:${providerId}

  alt Care-team conversation exists
    ConversationTable-->>AdminLambda: Return existing conversation
    AdminLambda->>AdminLambda: Reuse existing conversation
  else Care-team conversation does not exist
    AdminLambda->>ConversationTable: Create care-team Conversation
    ConversationTable-->>AdminLambda: Return created conversation
  end

  AdminLambda->>ParticipantTable: Ensure participant ${conversationId}:${patientId}
  ParticipantTable-->>AdminLambda: Created or reused patient participant

  AdminLambda->>ParticipantTable: Ensure participant ${conversationId}:${providerId}
  ParticipantTable-->>AdminLambda: Created or reused provider participant

  AdminLambda->>CloudWatch: Log created/reused records

  AdminLambda-->>RestAPI: Return idempotent workflow result
  RestAPI-->>AdminUI: Show success state
```

## Deterministic records created by this flow

The Admin relationship workflow creates or reuses these records:

```txt
ProviderPatient:
PP:${providerId}:${patientId}

Care-team conversation:
CARE_TEAM:${patientId}:${providerId}

Patient participant:
${conversationId}:${patientId}

Provider participant:
${conversationId}:${providerId}
```

## Idempotent behavior

The same Admin action can be run more than once without creating duplicate records.

For example, connecting the same Patient and Provider a second time should reuse:

```txt
PP:${providerId}:${patientId}
CARE_TEAM:${patientId}:${providerId}
${conversationId}:${patientId}
${conversationId}:${providerId}
```

Instead of creating another Patient / Provider relationship or another care-team conversation.

## Why this matters

This flow demonstrates several senior-level engineering decisions:

- **Relationship creation is controlled by backend workflow logic**, not scattered across frontend screens.
- **Admin actions are validated server-side** before records are created.
- **Deterministic IDs make the workflow idempotent**, so repeated actions do not corrupt the data model.
- **The care-team conversation is created from the Patient / Provider relationship**, keeping conversation structure aligned with the domain model.
- **ConversationParticipant rows are explicitly ensured**, making membership and access easier to reason about.
- **CloudWatch logging supports debugging backend workflows**, especially when validating complex multi-table writes.

## Important limitations and demo assumptions

HealthConnect is a portfolio/demo app and not a production healthcare administration system.

Current limitations and assumptions include:

- The app is not HIPAA-compliant.
- Admin users are part of the demo experience and would need stronger provisioning, audit trails, and access controls in production.
- The workflow demonstrates backend-owned consistency, but it is not a full enterprise identity-management system.
- The diagram focuses on the Patient / Provider relationship path and does not show every possible Admin screen action.
- Production systems would need additional monitoring, alerting, retries, transactional guarantees where appropriate, and security review.
- The current design is intentionally scoped for a clear employer-facing portfolio project.

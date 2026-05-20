# Frontend-to-Backend Request Flow

This diagram shows how HealthConnect moves from frontend user actions to authenticated backend requests.

It covers the main request paths for login, GraphQL operations, REST admin workflows, DynamoDB persistence, and error handling.

HealthConnect uses AWS Amplify on the client to communicate with Cognito, AppSync GraphQL, and API Gateway-backed Lambda functions.

```mermaid
sequenceDiagram
  autonumber

  actor User as User
  participant App as React Native / Expo App
  participant Amplify as AWS Amplify Client
  participant Cognito as Cognito User Pool
  participant IdentityPool as Cognito Identity Pool
  participant AppSync as AppSync GraphQL API
  participant APIGateway as API Gateway REST API
  participant Lambda as Lambda Functions
  participant DynamoDB as DynamoDB Tables
  participant CloudWatch as CloudWatch Logs

  User->>App: Select demo role / user
  App->>Amplify: Sign in with demo credentials
  Amplify->>Cognito: Authenticate user

  alt Login succeeds
    Cognito-->>Amplify: Return user session / JWT tokens
    Amplify->>IdentityPool: Exchange identity for AWS credentials
    IdentityPool-->>Amplify: Return temporary AWS credentials
    Amplify-->>App: Authenticated session available
    App->>App: Load role-based navigation
  else Login fails
    Cognito-->>Amplify: Auth error
    Amplify-->>App: Return login error
    App-->>User: Show friendly auth error
  end

  User->>App: Open screen / perform app action
  App->>Amplify: Run GraphQL query or mutation
  Amplify->>AppSync: Send request with auth context

  alt Authorized GraphQL request
    AppSync->>AppSync: Apply @auth rules / resolver logic
    AppSync->>DynamoDB: Read or write application data
    DynamoDB-->>AppSync: Return data
    AppSync-->>Amplify: Return GraphQL response
    Amplify-->>App: Return normalized result
    App-->>User: Render updated UI
  else Unauthorized or invalid GraphQL request
    AppSync-->>Amplify: Auth / validation / resolver error
    Amplify-->>App: Return API error
    App-->>User: Show user-safe error message
  end

  opt Admin-only REST workflow
    Admin->>App: Create user or connect Patient / Provider
    App->>Amplify: Call REST endpoint
    Amplify->>APIGateway: Send request with auth credentials
    APIGateway->>Lambda: Invoke admin workflow Lambda

    Lambda->>Lambda: Validate admin permissions
    Lambda->>DynamoDB: Create or reuse records
    DynamoDB-->>Lambda: Return persistence result
    Lambda->>CloudWatch: Write debug / operational logs
    Lambda-->>APIGateway: Return workflow response
    APIGateway-->>Amplify: Return REST response
    Amplify-->>App: Return result
    App-->>Admin: Show success or failure state
  end
```

## Why this matters

This flow demonstrates several senior-level engineering decisions:

- **Authentication is centralized through Cognito** instead of custom client-side identity handling.
- **The frontend does not write directly to DynamoDB**. It goes through AppSync GraphQL or backend Lambda workflows.
- **Authorization is enforced at the API/backend layer**, not only through hidden frontend buttons.
- **Admin workflows use backend-owned logic** so relationship creation can be validated, idempotent, and consistent.
- **Errors are treated as part of the system design**, with auth, API, validation, and resolver failures flowing back to user-safe UI messages.
- **CloudWatch is included in the request path** for operational debugging of backend workflows.

## Important limitations and demo assumptions

HealthConnect is a portfolio/demo app and not a production healthcare system.

Current limitations and assumptions include:

- Demo login uses preconfigured users to make employer review easier.
- The app demonstrates role-based authorization patterns, but a real healthcare system would require deeper compliance, audit logging, least-privilege review, threat modeling, and security testing.
- Admin REST workflows are intentionally project-specific and are not a general-purpose user management platform.
- Error handling is designed for demo clarity, but production systems would need more standardized error classification, alerting, retry behavior, and incident response.
- CloudWatch is used for backend troubleshooting, but the project does not yet include a complete observability setup with alarms, metrics dashboards, distributed tracing, or structured log search.

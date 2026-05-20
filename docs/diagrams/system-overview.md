# System Overview

This diagram shows the major pieces of the HealthConnect system and how they fit together across the frontend, AWS backend, deployment layer, and operational logging.

HealthConnect is a portfolio/demo healthcare communication app built with React Native, Expo, AWS Amplify Gen 1, AppSync GraphQL, Cognito, DynamoDB, Lambda, API Gateway, and CloudWatch.

It is designed to demonstrate production-style architecture decisions, but it is **not a HIPAA-compliant production healthcare system**.

```mermaid
flowchart TB
  %% ======================
  %% Users
  %% ======================
  subgraph Users["Users / Demo Roles"]
    Patient["Patient"]
    Provider["Provider"]
    Advocate["Patient Advocate"]
    Admin["Admin"]
  end

  %% ======================
  %% Frontend
  %% ======================
  subgraph Frontend["Frontend: React Native / Expo"]
    MobileApp["Mobile App<br/>iOS / Android"]
    WebDemo["Expo Web Demo<br/>healthconnect.expo.app"]
    RoleNavigation["Role-Based Navigation<br/>Patient / Provider / Advocate / Admin"]
    DemoLogin["Demo Login<br/>Preconfigured Role Users"]
    MessagingUI["Messaging UI<br/>DMs + Care-Team Chats"]
    CallUI["Video Call Flow<br/>Mobile Only"]
    WebGuardrails["Web Guardrails<br/>Mobile-only feature notices"]
  end

  %% ======================
  %% Auth
  %% ======================
  subgraph Auth["Authentication & Authorization"]
    CognitoUserPool["Cognito User Pool<br/>User authentication"]
    CognitoIdentityPool["Cognito Identity Pool<br/>AWS credentials / IAM access"]
    AppSyncAuthRules["AppSync @auth Rules<br/>Owner + role/group access"]
  end

  %% ======================
  %% API Layer
  %% ======================
  subgraph API["API Layer"]
    AppSync["AWS AppSync GraphQL API<br/>Queries / Mutations / Subscriptions"]
    APIGateway["API Gateway REST API<br/>Admin / seeding endpoints"]
  end

  %% ======================
  %% Backend Compute
  %% ======================
  subgraph Compute["Backend Compute"]
    GraphQLResolvers["AppSync Resolvers<br/>Model access + custom logic"]
    RestLambdas["REST Lambdas<br/>Admin user and relationship workflows"]
    CustomLambdas["Custom Lambdas<br/>Invite approval / guarded workflows"]
  end

  %% ======================
  %% Data
  %% ======================
  subgraph Data["Data Layer: DynamoDB"]
    UserTable["User"]
    ConversationTable["Conversation"]
    ParticipantTable["ConversationParticipant"]
    MessageTable["Message"]
    ProviderPatientTable["ProviderPatient"]
    AdvocateAssignmentTable["AdvocateAssignment"]
    AdvocateInviteTable["AdvocateInvite"]
  end

  %% ======================
  %% Observability
  %% ======================
  subgraph Ops["Operations / Observability"]
    CloudWatch["CloudWatch Logs<br/>Lambda debugging + API troubleshooting"]
  end

  %% ======================
  %% Hosting
  %% ======================
  subgraph Hosting["Deployment / Hosting"]
    ExpoHosting["Expo Hosting<br/>Employer-facing web demo"]
    GitHubRepo["GitHub Repository<br/>Source code + docs"]
  end

  %% User interactions
  Patient --> MobileApp
  Provider --> MobileApp
  Advocate --> MobileApp
  Admin --> MobileApp

  Patient --> WebDemo
  Provider --> WebDemo
  Advocate --> WebDemo
  Admin --> WebDemo

  %% Frontend structure
  MobileApp --> DemoLogin
  WebDemo --> DemoLogin
  DemoLogin --> CognitoUserPool

  MobileApp --> RoleNavigation
  WebDemo --> RoleNavigation

  RoleNavigation --> MessagingUI
  RoleNavigation --> CallUI
  WebDemo --> WebGuardrails

  %% Auth flow
  CognitoUserPool --> CognitoIdentityPool
  CognitoIdentityPool --> AppSync
  CognitoIdentityPool --> APIGateway
  CognitoUserPool --> AppSyncAuthRules
  AppSyncAuthRules --> AppSync

  %% API flow
  MessagingUI --> AppSync
  RoleNavigation --> AppSync
  RoleNavigation --> APIGateway

  APIGateway --> RestLambdas
  AppSync --> GraphQLResolvers
  AppSync --> CustomLambdas

  %% Data access
  GraphQLResolvers --> UserTable
  GraphQLResolvers --> ConversationTable
  GraphQLResolvers --> ParticipantTable
  GraphQLResolvers --> MessageTable
  GraphQLResolvers --> ProviderPatientTable
  GraphQLResolvers --> AdvocateAssignmentTable
  GraphQLResolvers --> AdvocateInviteTable

  RestLambdas --> UserTable
  RestLambdas --> ConversationTable
  RestLambdas --> ParticipantTable
  RestLambdas --> ProviderPatientTable

  CustomLambdas --> ConversationTable
  CustomLambdas --> ParticipantTable
  CustomLambdas --> MessageTable
  CustomLambdas --> AdvocateAssignmentTable
  CustomLambdas --> AdvocateInviteTable

  %% Realtime subscriptions
  AppSync -. GraphQL subscriptions .-> MessagingUI

  %% Logs
  RestLambdas --> CloudWatch
  CustomLambdas --> CloudWatch
  GraphQLResolvers --> CloudWatch

  %% Hosting
  GitHubRepo --> ExpoHosting
  ExpoHosting --> WebDemo
```

## Why this matters

This system shape demonstrates several senior-level engineering decisions:

- **Clear separation of concerns** between frontend screens, authentication, API access, backend workflow logic, and persistence.
- **Role-based product design** for Patients, Providers, Advocates, and Admins instead of a single generic user flow.
- **Managed cloud architecture** using Cognito, AppSync, DynamoDB, Lambda, API Gateway, and CloudWatch.
- **Realtime-first messaging architecture** using AppSync GraphQL subscriptions.
- **Backend-owned relationship workflows** for admin and advocate actions instead of relying only on client-side writes.
- **Portfolio-friendly deployment strategy** using Expo web hosting while still treating the app as mobile-first.

## Important limitations and demo assumptions

HealthConnect is an employer-facing portfolio project, not a production healthcare platform.

Current limitations and assumptions include:

- The app is **not HIPAA-compliant**.
- Demo login uses preconfigured users for easier reviewer access.
- Web deployment is intended for employer review, while some features remain mobile-only.
- Video calling is treated as a mobile feature and guarded on web.
- Authorization patterns demonstrate production-style thinking, but would need additional hardening, auditing, compliance review, and operational controls for real healthcare use.
- CloudWatch is used for Lambda/API troubleshooting, but the project does not yet include a full observability stack with metrics, alarms, tracing, dashboards, or incident response workflows.

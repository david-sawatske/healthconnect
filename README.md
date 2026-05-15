# HealthConnect

HealthConnect is a role-based healthcare communication app built with **React Native**, **Expo**, and **AWS Amplify**. It connects **patients**, **providers**, **patient advocates**, and **admins** through secure, relationship-driven communication workflows including direct messaging, care-team conversations, realtime updates, and video-call signaling.

This project is designed as a portfolio application to demonstrate production-style thinking across frontend architecture, serverless backend design, authentication, authorization, realtime communication, and realistic domain workflows.

> **Note:** HealthConnect is a portfolio/demo application. It is not intended for real patient care or production healthcare use without additional compliance, security, auditing, monitoring, and operational review.

## Live Demo

Web demo: https://healthconnect.expo.app

> The web version is intended for employer review. Some native mobile features, such as video calling and file uploads, may show browser fallback behavior.

---

## Table of Contents

* [Overview](#overview)
* [Why This Project Exists](#why-this-project-exists)
* [Core Features](#core-features)
* [User Roles](#user-roles)
* [Demo Experience](#demo-experience)
* [Key Workflows](#key-workflows)
* [Architecture Summary](#architecture-summary)
* [Tech Stack](#tech-stack)
* [AWS Services Used](#aws-services-used)
* [Frontend Architecture](#frontend-architecture)
* [Backend Architecture](#backend-architecture)
* [Data Model Highlights](#data-model-highlights)
* [Authentication and Authorization](#authentication-and-authorization)
* [Realtime Chat](#realtime-chat)
* [Video Calling](#video-calling)
* [Admin and Seeding Tools](#admin-and-seeding-tools)
* [Web Demo Considerations](#web-demo-considerations)
* [What This Project Demonstrates](#what-this-project-demonstrates)
* [Local Development](#local-development)
* [Environment Variables](#environment-variables)
* [Suggested Employer Review Path](#suggested-employer-review-path)
* [Known Limitations](#known-limitations)
* [Future Improvements](#future-improvements)

---

## Overview

HealthConnect models a realistic healthcare communication environment where access to conversations is based on actual relationships between users.

Instead of creating chats simply because users exist, HealthConnect follows a more realistic rule:

> **Communication access is created through relationships.**

For example:

* A patient can message a provider after an admin connects that patient to the provider.
* A care-team chat is created for a specific patient/provider relationship.
* A patient advocate can join that care-team chat only after being invited and approved.
* Direct messages and group conversations are separated so users can clearly understand who they are communicating with.

This approach demonstrates backend workflow design, role-based user experience, and access-control thinking beyond a simple CRUD app.

---

## Why This Project Exists

HealthConnect was built to demonstrate full-stack engineering skills in a domain where communication, access control, and user roles matter.

The app is intended to show employers that I can:

* Build a cross-platform mobile app with React Native and Expo.
* Design role-based user experiences.
* Use AWS Amplify, AppSync, Cognito, DynamoDB, Lambda, and API Gateway.
* Model realistic data relationships.
* Implement realtime messaging patterns.
* Build protected admin workflows.
* Think through access control, idempotency, and backend side effects.
* Polish a project so it can be reviewed by both technical and non-technical audiences.

---

## Core Features

### Role-Based App Experience

HealthConnect supports four user roles:

* **Patient**
* **Provider**
* **Patient Advocate**
* **Admin**

Each role has its own home screen, navigation options, and available workflows.

### Relationship-Driven Communication

Chats are created based on relationships, not just user accounts.

Examples:

* Patient-provider relationships create direct communication options.
* Care-team chats are tied to a specific patient/provider relationship.
* Advocate access is granted through an invite and approval flow.

### Realtime Messaging

Users can send and receive chat messages with realtime updates powered by AWS AppSync subscriptions.

### Care-Team Conversations

A care-team conversation allows a patient, provider, and approved advocate to communicate in a shared context.

### Direct Messaging

Patients, providers, and advocates can participate in direct conversations where appropriate.

### Video Call Signaling

HealthConnect includes WebRTC-based call workflows with AWS-backed signaling. The app models call start, decline, hang-up, timeout, and related system-message behavior.

### Admin Workflows

Admins can:

* Seed demo data.
* Create users.
* Connect patients to providers.
* Create patient-provider relationships.
* Trigger care-team chat creation through relationship workflows.
* Invite advocates into patient/provider care teams.

### Demo Mode

The app includes a demo login flow that allows reviewers to choose a role and sign in as predefined users.

---

## User Roles

## Patient

Patients can:

* View connected providers.
* Open direct conversations with providers.
* View care-team chat availability.
* Communicate with approved advocates.
* Participate in care-team conversations.
* Receive realtime message updates.

Patients are the center of the relationship model. Provider and advocate access is organized around patient care relationships.

## Provider

Providers can:

* View assigned patients.
* Open patient detail views.
* Communicate with patients.
* Participate in care-team chats.
* Communicate with advocates where advocate access exists.

The provider experience is designed around managing communication across multiple patients.

## Patient Advocate

Patient advocates can:

* View patients they are associated with.
* See provider-specific care-team options for each patient.
* Direct message patients or providers where appropriate.
* Participate in care-team chats after approval.

The advocate role demonstrates more complex relationship modeling because an advocate may be associated with the same patient across multiple providers.

## Admin

Admins can:

* Create users.
* Connect patients and providers.
* Invite advocates to care teams.
* Seed demo data.
* Validate relationship-driven workflows.

The admin role demonstrates protected backend operations and realistic user-management flows.

---

## Demo Experience

HealthConnect includes demo users for each role so reviewers can explore the app without creating accounts manually.

Typical demo roles include:

| Role     | Purpose                                                     |
| -------- | ----------------------------------------------------------- |
| Patient  | Explore patient-provider conversations and care-team access |
| Provider | Review assigned patients and patient communication options  |
| Advocate | Review patient/provider-specific advocate workflows         |
| Admin    | Create users, connect relationships, and seed demo data     |

The demo login screen is designed to let a reviewer choose a role, select a demo user for that role, and enter the app quickly.

---

## Key Workflows

## 1. Admin Creates a User

An admin can create a user profile for a patient, provider, or advocate.

Important architectural rule:

> Creating a user does not automatically create communication access.

This keeps identity creation separate from relationship creation.

## 2. Admin Connects a Patient to a Provider

When an admin connects a patient to a provider, the backend ensures:

* A `ProviderPatient` relationship exists.
* A canonical care-team conversation exists.
* Conversation participants exist for the patient and provider.
* Repeated requests do not create duplicate records.

## 3. Care-Team Chat Is Created From the Relationship

A care-team chat is tied to one patient/provider relationship.

Canonical ID format:

```txt
CARE_TEAM:${patientId}:${providerId}
```

This makes the relationship deterministic and prevents duplicate care-team chats for the same patient/provider pair.

## 4. Advocate Is Invited

An admin or supported workflow can invite an advocate to a patient/provider care team.

The invite starts as pending and is guarded against duplicate or invalid invite states.

## 5. Advocate Is Approved

When an advocate is approved:

* The invite status changes to approved.
* The advocate is added to the care-team conversation.
* A conversation participant record is created for the advocate.
* A system message can be added to the chat to reflect the workflow event.

## 6. Users Communicate in Context

After relationships are established, users communicate through:

* Direct messages.
* Care-team group chats.
* Realtime chat updates.
* Video-call workflows.

---

## Architecture Summary

HealthConnect uses a serverless architecture with a React Native frontend and AWS-managed backend services.

```txt
React Native / Expo App
        |
        | Authenticated requests
        v
AWS Amplify
        |
        |-----------------------------|
        |                             |
        v                             v
Amazon Cognito                 AWS AppSync GraphQL API
User Pool + Identity Pool             |
                                      v
                                Amazon DynamoDB
                                      |
                                      v
                           Relationship + chat data

Additional backend workflows:

React Native App
        |
        v
API Gateway REST API
        |
        v
AWS Lambda
        |
        v
Cognito + DynamoDB
```

High-level design principles:

* Keep identity separate from access.
* Let relationships drive conversations.
* Use deterministic IDs to avoid duplicate records.
* Use idempotent backend operations where possible.
* Keep frontend role flows clear and domain-focused.
* Use AWS-managed services for auth, APIs, data, and backend workflow execution.

---

## Tech Stack

## Frontend

* React Native
* Expo
* JavaScript
* React Navigation
* AWS Amplify client libraries
* React Native Web support for browser demo workflows

## Backend

* AWS Amplify Gen 1
* AWS AppSync GraphQL API
* Amazon DynamoDB
* Amazon Cognito
* AWS Lambda
* Amazon API Gateway

## Communication

* AppSync GraphQL subscriptions for realtime chat behavior
* WebRTC for video-call behavior on supported platforms
* GraphQL-backed signaling models for call state and signaling messages

---

## AWS Services Used

| Service                      | Purpose                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Amazon Cognito User Pool     | User authentication                                                                            |
| Amazon Cognito Identity Pool | AWS credential access for authenticated users                                                  |
| AWS AppSync                  | GraphQL API and realtime subscriptions                                                         |
| Amazon DynamoDB              | Persistent app data for users, relationships, conversations, messages, invites, and call state |
| AWS Lambda                   | Protected backend workflows such as admin user management and invite approval                  |
| Amazon API Gateway           | REST endpoints for admin/seeding workflows                                                     |
| AWS Amplify Gen 1            | Backend provisioning, generated GraphQL operations, and frontend integration                   |

---

## Frontend Architecture

The frontend is organized around feature areas and role-specific screens.

Example structure:

```txt
src/
  features/
    admin/
    calls/
    chat/
  navigation/
  screens/
  services/
    amplify/
    realtime/
  theme.js
```

Key frontend patterns:

* Role-based navigation.
* Shared theme values for consistent spacing, colors, and UI polish.
* Feature-based organization for admin, chat, and call logic.
* Reusable service modules for Amplify and GraphQL interactions.
* Platform-aware behavior for web versus mobile capabilities.
* Demo-mode login flow for employer review.

---

## Backend Architecture

The backend uses AWS Amplify Gen 1 resources with GraphQL models, DynamoDB tables, Cognito auth, and Lambda functions.

Important backend responsibilities include:

* Managing user profile records.
* Managing patient-provider relationships.
* Managing advocate assignments and invites.
* Creating canonical conversations.
* Ensuring conversation participants exist.
* Supporting realtime messages.
* Handling protected admin workflows.
* Supporting call signaling and call state.

---

## Data Model Highlights

HealthConnect uses deterministic IDs for important relationship records.

## Care-Team Conversation

```txt
CARE_TEAM:${patientId}:${providerId}
```

Used to ensure one care-team conversation per patient/provider relationship.

## Direct Message Conversation

```txt
DM:${minUserId}:${maxUserId}
```

The two user IDs are sorted lexicographically so the same two users always resolve to the same direct-message conversation.

## Patient-Provider Relationship

```txt
PP:${providerId}:${patientId}
```

Used to model provider assignment to a patient.

## Advocate Assignment

```txt
PA:${patientId}:PR:${providerId}:ADV:${advocateId}
```

Used to model advocate access for a specific patient/provider relationship.

## Conversation Participant

Conversation participants connect users to conversations and support per-user read/access behavior.

Example:

```txt
${conversationId}:${userId}
```

These deterministic IDs help make backend operations idempotent and predictable.

---

## Authentication and Authorization

HealthConnect uses Amazon Cognito for authentication and AWS AppSync authorization rules for GraphQL data access.

The app models several access-control concepts:

* Authenticated users can access their own role-specific experience.
* Conversation access is based on membership.
* Admin-only operations are protected through backend workflows.
* Relationship creation is handled separately from user creation.
* Advocate access requires invite/approval state before being added to care-team communication.

This design keeps the app closer to a real-world access model than a simple shared chat demo.

---

## Realtime Chat

HealthConnect supports realtime chat behavior using AppSync GraphQL subscriptions.

Messaging features include:

* Direct conversations.
* Group care-team conversations.
* Conversation participant tracking.
* Message creation and realtime updates.
* System messages for workflow events such as call status or advocate approval.
* Global realtime listener behavior for app-wide message awareness.

The app also avoids treating all messages the same. For example, system messages can be handled differently from user-generated chat messages.

---

## Video Calling

HealthConnect includes WebRTC-based video-call workflows on supported mobile platforms.

The call system models:

* Starting a call.
* Receiving a call.
* Declining a call.
* Hanging up.
* Timing out when unanswered.
* Posting call-ended system messages.
* Avoiding duplicate system messages from both sides of a call.

The app uses AWS-backed signaling models to coordinate call state between users.

Because browser support differs from native mobile support, the web demo includes graceful fallback behavior for mobile-only call features.

---

## Admin and Seeding Tools

HealthConnect includes admin tools to make the app easy to demo and evaluate.

Admin capabilities include:

* Seed demo users and relationships.
* Create users.
* Connect patients to providers.
* Invite advocates to care-team workflows.
* Validate relationship-driven chat creation.

The seeding and admin flows are designed to be repeatable and predictable.

Important backend design choices:

* Use idempotent ensure-style operations.
* Avoid duplicate conversations.
* Avoid duplicate relationship records.
* Keep user creation separate from relationship creation.
* Keep relationship creation responsible for access and chat creation.

---

## Web Demo Considerations

HealthConnect is primarily a React Native mobile app, but it also includes web-demo support for employer review.

Some native mobile features, such as WebRTC video calling and file upload behavior, may be limited or disabled on web. Where appropriate, the app uses platform checks to show clear fallback messages instead of broken controls.

This allows reviewers to explore the product and architecture from a browser while preserving full-feature intent for mobile platforms.

---

## What This Project Demonstrates

HealthConnect demonstrates more than UI screens. It shows full-stack product and engineering decision-making.

## Full-Stack Development

* React Native frontend
* AWS serverless backend
* GraphQL API integration
* REST API integration
* Cognito authentication
* DynamoDB data modeling
* Lambda workflow design

## Product Thinking

* Healthcare communication domain modeling
* Role-specific user journeys
* Patient/provider/advocate/admin workflows
* Demo-friendly onboarding
* Clear separation between direct messages and care-team chats

## Backend Design

* Relationship-driven access
* Deterministic IDs
* Idempotent operations
* Protected admin workflows
* Realtime subscriptions
* Serverless architecture

## Frontend Design

* Role-aware navigation
* Reusable feature modules
* Shared theme system
* Mobile-first UX
* Web-aware fallbacks
* Employer-demo polish

## Engineering Judgment

* Honest demo scope
* Separation of identity and access
* Avoidance of duplicate records
* Clear workflow boundaries
* Production-inspired patterns without overstating production readiness

---

## Local Development

> Exact setup may vary depending on local AWS Amplify configuration and environment access.

## Prerequisites

* Node.js
* npm or yarn
* Expo CLI / Expo tooling
* AWS Amplify CLI
* AWS account with appropriate Amplify permissions
* Configured Amplify environment

## Install Dependencies

```bash
npm install
```

## Start the App

```bash
npx expo start
```

## Run on Web

```bash
npx expo start --web
```

## Run on iOS or Android

Use Expo development tooling or a development build depending on the native modules required by the current branch.

---

## Environment Variables

HealthConnect uses environment variables for demo login behavior and backend configuration.

Example demo login variables:

```env
EXPO_PUBLIC_DEMO_LOGIN=true

EXPO_PUBLIC_DEMO_PATIENT_EMAIL=patient@example.com
EXPO_PUBLIC_DEMO_PATIENT_PASSWORD=Password123!

EXPO_PUBLIC_DEMO_PROVIDER_EMAIL=provider@example.com
EXPO_PUBLIC_DEMO_PROVIDER_PASSWORD=Password123!

EXPO_PUBLIC_DEMO_ADVOCATE_EMAIL=advocate@example.com
EXPO_PUBLIC_DEMO_ADVOCATE_PASSWORD=Password123!

EXPO_PUBLIC_DEMO_ADMIN_EMAIL=admin@example.com
EXPO_PUBLIC_DEMO_ADMIN_PASSWORD=Password123!
```

> Demo credentials should only be used for demo environments. Do not use real credentials or production patient data in this project.

Lambda functions also use environment variables for table names, region configuration, Cognito resources, and environment-specific backend behavior.

---

## Suggested Employer Review Path

For a quick review, follow this path:

1. Start with the demo login screen.
2. Log in as an **Admin**.
3. Review the user creation and patient-provider connection workflows.
4. Confirm that care-team chats are created from relationships.
5. Log in as a **Patient** and review provider communication options.
6. Log in as a **Provider** and review assigned patients.
7. Log in as an **Advocate** and review patient/provider-specific advocate workflows.
8. Open chat screens and review realtime messaging behavior.
9. Review the code organization under `src/features`, `src/screens`, `src/navigation`, and `src/services`.
10. Review Amplify backend resources under `amplify/backend`.

Suggested files/directories to inspect:

```txt
src/screens/
src/features/admin/
src/features/chat/
src/features/calls/
src/services/amplify/
src/services/realtime/
amplify/backend/api/
amplify/backend/function/
```

---

## Known Limitations

HealthConnect is a portfolio project and intentionally does not claim production healthcare readiness.

Known limitations include:

* No formal HIPAA compliance implementation.
* No production audit logging system.
* No production monitoring or alerting setup.
* No full end-to-end automated test suite yet.
* Demo credentials are intended only for review environments.
* Web support includes fallbacks for some mobile-only features.
* Some workflows are simplified to keep the project focused and reviewable.

---

## Future Improvements

Potential future improvements include:

* Add automated tests for critical relationship and chat workflows.
* Add deeper audit logging for admin actions.
* Add monitoring and error reporting.
* Improve accessibility coverage.
* Expand notification support.
* Add richer provider workflows.
* Add more complete profile management.
* Add file attachment support with stronger access controls.
* Improve deployment documentation.
* Add architecture diagrams and screenshots to documentation.

---

## Project Status

HealthConnect is actively maintained as a portfolio project focused on demonstrating full-stack engineering, AWS serverless architecture, and realistic role-based healthcare communication workflows.

---

## Author

Built by David Sawatske as a full-stack portfolio project demonstrating React Native, AWS Amplify, realtime communication, and production-style application architecture.

# Stage 1 Foundation

## Summary

Stage 1 is an internal MVP for setting up and managing board game chatrooms and their associated document-processing pipeline.

The app supports two roles: `admin` and `user`.

- `admin` users can log in, view chatrooms, create new chatrooms, and access config pages for managing uploaded PDFs and generated document artifacts.
- `user` users can log in, but their product-facing experience is not yet available. They should land on a simple “under construction” page after login.

Stage 1 is focused on internal configuration and document preparation. It does not yet include live chat with an LLM.

---

## What Stage 1 is

Stage 1 includes:

- a project scaffold that supports spec-driven development
- a login flow connected to the existing PostgreSQL users table
- a required Terms and Conditions checkbox before login
- a Terms and Conditions popup accessible from the login page
- role-aware routing after login
- an admin homepage that lists existing chatrooms
- an admin flow to create a new chatroom
- an admin config page for each chatroom
- PDF upload/reupload for a chatroom’s documents
- generation and configuration of:
  - canonical words
  - outline / document nodes
  - chunks

Stage 1 is an internal configuration MVP, not an end-user chat product.

---

## What Stage 1 explicitly excludes

Stage 1 does not include:

- live user chat with documents
- LLM response generation
- feedback collection on chat answers
- production-scale concurrency optimization
- vector retrieval / semantic search runtime
- Redis / queue infrastructure unless later required by a specific implementation detail
- polished end-user chatroom experience

User-facing chatroom access may appear in the UI as disabled or “under construction.”

---

## Roles

### Admin
Admins can:

- log in
- view the admin homepage
- see existing chatrooms
- click into a chatroom’s config page
- create a new chatroom
- upload or reupload PDFs
- trigger parsing and generation flows
- configure generated artifacts where applicable

### User
Users can:

- log in
- be routed into the app
- see a placeholder / under-construction page

Users cannot access admin configuration flows in Stage 1.

---

## Core entities

Stage 1 is built around the following core entities:

- `users`
- `documents`
- `chatrooms`
- `chatroom_documents`
- `document_nodes`
- `document_chunks`
- `document_canonical_words`

### Entity notes

- A chatroom represents a board game on the backend.
- A chatroom can have multiple documents.
- A game is a UI/product concept, but `chatroom` is the canonical backend term.
- Stage 1 includes the UI and backend support needed to manage the document artifacts tied to a chatroom.

---

## First flows

## 1. Login flow
- User opens the login page.
- User sees username and password inputs.
- User must check a checkbox agreeing to the Terms and Conditions before login is allowed.
- Clicking “Terms and Conditions” opens a popup/modal showing the document.
- Credentials are checked against the existing PostgreSQL `users` table.
- Plaintext password matching is acceptable for this internal MVP.
- On success:
  - admins go to the admin homepage
  - users go to an under-construction page

## 2. Admin homepage flow
- Admin lands on a homepage after login.
- The page includes:
  - navbar
  - brand/logo area on the top left
  - logout action
  - list of existing chatrooms
- Chatrooms are shown as medium-sized chips/cards.
- Admin can click a chatroom card to enter its config page.
- Any user-facing “enter chatroom” action is disabled or marked under construction.

## 3. Create new chatroom flow
- Admin clicks a button from the homepage to create a new chatroom / board game.
- The new chatroom is stored in PostgreSQL.
- After creation, it becomes visible in the homepage list.

## 4. Chatroom config flow
- Admin opens a chatroom config page.
- Admin can:
  - upload or reupload a PDF
  - trigger parse
  - generate canonical words
  - generate outline / nodes
  - generate chunks
  - configure/edit generated outputs as supported by the feature
- Generated artifacts are persisted in the relevant PostgreSQL tables.

## 5. User placeholder flow
- User logs in successfully.
- User is routed to a placeholder page indicating the product/chat experience is still under construction.

---

## Stack

Stage 1 uses:

- **Frontend:** Next.js
- **Backend API / processing service:** FastAPI
- **Database:** PostgreSQL

### Stack responsibilities

#### Next.js
Responsible for:
- login UI
- terms popup
- role-based routing
- admin homepage
- config page UI
- internal app navigation

#### FastAPI
Responsible for:
- parsing and document-processing endpoints
- canonical word generation
- outline generation
- chunk generation
- backend business logic related to Stage 1 processing flows

#### PostgreSQL
Responsible for:
- existing users table
- chatrooms and documents
- chatroom-document associations
- generated document artifacts

---

## Repo boundaries

The repo should be scaffolded to support Stage 1 only.

It should include:

- a Next.js app for frontend/internal UI
- a FastAPI service for backend processing
- clear separation between UI and processing logic
- spec-driven project structure
- room for future stages without prematurely implementing Stage 2 or Stage 3 systems

Stage 1 should not introduce infrastructure that is only needed for later scaling unless a current Stage 1 requirement truly depends on it.

---

## Stage 1 completion criteria

Stage 1 is considered complete when:

- admins and users can log in using the existing PostgreSQL users table
- the Terms and Conditions checkbox and popup are functional
- admins are routed to an admin homepage
- users are routed to an under-construction page
- admins can see existing chatrooms from PostgreSQL
- admins can create a new chatroom
- admins can access a config page for a chatroom
- admins can upload/reupload a PDF for a chatroom
- admins can trigger and persist parsing/generation outputs for:
  - canonical words
  - outline / nodes
  - chunks
- Stage 2 features like live chat and feedback are still excluded
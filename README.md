# RuleResolve

Internal MVP for setting up and managing board game chatrooms and their document-processing pipeline.

## Overview

Stage 1 supports two roles:

- **admin** — can log in, manage chatrooms, upload PDFs, and configure document-processing outputs
- **user** — can log in and sees an under-construction placeholder

## Stack

| Layer    | Tech       |
|----------|------------|
| Frontend | Next.js (TypeScript) |
| Backend  | FastAPI (Python) |
| Database | PostgreSQL |

## Repo Structure

```
apps/
  web/          Next.js frontend
  api/          FastAPI backend
_specs/         Feature and architecture specs
tests/          Integration tests
```

Unit tests live alongside their app:
- `apps/web/**/*.test.tsx` for frontend
- `apps/api/tests/` for backend

The root `tests/` is reserved for integration tests that span both services.

## Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL (running locally or via a connection string)

## Setup

```bash
# Install all dependencies
make install
```

Or individually:

```bash
make install-web   # npm install for frontend
make install-api   # create .venv and pip install for backend
```

## Environment Variables

Copy the example files and fill in your values:

```bash
cp apps/web/.env.local.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

See each `.env.example` for descriptions of the required variables.

## Running Locally

```bash
make dev        # run frontend and backend concurrently
make web        # frontend only  (http://localhost:3000)
make api        # backend only   (http://localhost:8000)
```

API docs are available at `http://localhost:8000/docs` when the backend is running.

## Lint & Format

```bash
make lint       # lint both apps
make format     # format both apps
make lint-web   # frontend only
make lint-api   # backend only
```

## Tests

```bash
make test       # run all tests
make test-web   # frontend only
make test-api   # backend only
```

## Supabase Storage Conventions

PDFs and derived assets are stored in the `chatroom-assets` bucket using this path structure:

```
{chatroomId}/documents/{documentId}/source/{filename.pdf}
{chatroomId}/documents/{documentId}/assets/cover.webp
```

### Manually seeding PDFs via Supabase

When inserting a document row directly in Supabase (instead of committing via the UI), ensure:

1. Upload the PDF to `{chatroomId}/documents/{documentId}/source/{filename.pdf}` in the `chatroom-assets` bucket
2. Insert a row into `documents` with `file_name` set to the **exact filename** used in storage (e.g. `monopoly-rules.pdf`)
3. Insert a row into `chatroom_documents` linking the `chatroom_id` and `document_id`

The config page derives the signed URL from `file_name` in the DB — if they don't match, the PDF will not load.

When a PDF is committed via the UI, the existing file is deleted from storage and replaced with the new upload under the new filename.

## Specs

Feature specs live in `_specs/features/`. Architecture specs live in `_specs/architecture/`.

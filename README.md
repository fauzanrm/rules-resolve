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

## Specs

Feature specs live in `_specs/features/`. Architecture specs live in `_specs/architecture/`.

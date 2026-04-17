# CLAUDE.md

## Project Overview

This repository contains Stage 1 of RuleResolve, an internal MVP for setting up and managing board game chatrooms and their associated document-processing pipeline.

Stage 1 supports two roles:
- `admin`: can log in, view chatrooms, create chatrooms, enter config pages, upload/reupload PDFs, and manage document-processing outputs
- `user`: can log in but only sees an under-construction placeholder experience

Stage 1 is an internal configuration product. It does **not** include live end-user chat, LLM answer generation, semantic retrieval runtime, or production-scale infrastructure unless a current Stage 1 requirement explicitly depends on it.

## Core Product Principles

- Build only what is needed for Stage 1.
- Prefer correctness and explicitness over cleverness or hidden automation.
- Preserve strong boundaries between stages in the document-processing workflow.
- Do not silently mutate upstream or source data when editing downstream derived artifacts.
- Favor simple, maintainable implementations over premature abstraction.
- Match the specs exactly unless the spec is clearly contradictory or incomplete.

## Source of Truth

- Product behavior should be driven by spec files.
- If a feature spec exists, follow it closely.
- If multiple specs interact, preserve the workflow and dependency rules already established by earlier stages.
- Do not invent alternate flows when the existing shell/workflow is already defined.

## Stage 1 Stack Boundaries

Use the stack with these responsibilities:

### Frontend
- Next.js
- Responsible for login UI, terms popup, role-aware routing, admin homepage, config page UI, and internal navigation

### Backend
- FastAPI
- Responsible for parsing and document-processing endpoints and backend business logic

### Database
- PostgreSQL
- Responsible for users, chatrooms, documents, chatroom-document associations, and generated document artifacts

Do not introduce extra infrastructure for later stages unless it is truly required by a current Stage 1 feature.

## Workflow Rules

- The config page shell is the base workflow for document processing stages.
- New document-processing work must respect the existing shell pattern rather than creating parallel flows.
- Stage behavior should remain explicit, operator-driven, and commit-based.
- Uncommitted changes must be treated as draft state and protected by navigation warnings where applicable.
- Avoid hidden autosaves unless a spec explicitly asks for them.

## Document Processing Rules

Treat the document pipeline as staged derived data:

1. PDF upload
2. Raw words
3. Canonical words
4. Outline / nodes
5. Chunks

General rules:
- Upstream artifacts are prerequisites for downstream stages.
- If an upstream dependency is replaced, regenerated, deleted, or invalidated, downstream data must follow the invalidation behavior defined in spec.
- Do not allow stale derived data to remain attached to mismatched upstream inputs.
- Derived stages should not mutate source PDF data or prior-stage source records unless explicitly required.

Specific integrity rules:
- Raw words are strictly dependent on the current source PDF.
- Canonical words are derived from raw words and must not mutate raw words.
- Outline nodes are derived from canonical words.
- Chunk assignment must use `assigned_node_id` as the source of truth for node assignment.
- `node_index` is derived UI/order state, not the persisted source of truth for chunk assignment.
- Chunk ordering within a node should be derived from canonical position.

## Persistence Philosophy

Prefer simple overwrite semantics for Stage 1 unless specs explicitly require versioning.

Examples:
- PDF upload overwrites the current stored PDF
- Derived outputs generally replace the prior committed active state
- Do not create hidden history/version systems unless explicitly requested

## UI / UX Expectations

- Preserve the config-page-shell structure and interaction model.
- Keep admin tooling clear, minimal, and internal-tool oriented.
- Make state obvious:
  - idle
  - generated
  - dirty / uncommitted
  - committed
  - invalidated
  - error
- When the spec calls for clear visual distinction between artifact states, implement that distinction plainly rather than subtly to the point of ambiguity.
- Respect unsaved-changes protections consistently across stages.

## Validation Philosophy

- Block invalid states early when possible.
- Do not silently auto-repair meaningful structural errors unless the spec explicitly prefers auto-resolution.
- Prefer validation errors over surprising inference.

Examples:
- Non-sequential explicit header selections should be blocked
- Overlapping explicit headers should be blocked
- Invalid hierarchy should be blocked rather than guessed
- Chunk ordering inside a node may auto-resolve to canonical order when that behavior is explicitly specified

## Naming and Terminology

Use the domain terms consistently:
- `chatroom` is the canonical backend term
- A board game is the UI/product concept
- Use existing entity names consistently:
  - `users`
  - `documents`
  - `chatrooms`
  - `chatroom_documents`
  - `document_canonical_words`
  - `document_nodes`
  - `document_chunks`

Do not introduce near-duplicate names for the same concept without a strong reason.

## Spec Writing Rules

When creating a new spec:
- Follow the existing spec template structure exactly:
  - Summary
  - Functional Requirements
  - Figma Design Reference
  - Possible Edge Cases
  - Acceptance Criteria
  - Open Questions
  - Testing Guidelines
- Do not add technical implementation details such as code examples unless explicitly requested.
- Keep specs product-oriented and behavior-driven.
- Respect previously established workflow and invalidation rules.
- If branch names are created from specs, use the `claude/feature/<slug>` pattern.
- Use clear, human-readable feature titles and safe kebab-case slugs.

## Coding Preferences

- Write simple, readable, unsurprising code.
- Prefer small composable units over dense abstractions.
- Keep frontend and backend responsibilities clearly separated.
- Avoid speculative architecture for Stage 2+.
- Preserve current behavior unless the spec explicitly changes it.
- When editing existing code, align with established patterns instead of introducing a new style midstream.

## Testing Expectations

For each feature:
- Add targeted tests under `./tests`
- Cover the key flows and edge cases listed in the spec
- Do not go excessively heavy if the spec explicitly says “without going too heavy”
- Prioritize:
  - happy path
  - invalidation behavior
  - navigation warning behavior
  - persistence behavior
  - ordering / hierarchy integrity where relevant

## When Requirements Are Ambiguous

If a spec is missing a detail:
1. First infer from the existing Stage 1 patterns and prior specs
2. Then choose the simpler behavior
3. Do not invent broad new systems to solve a narrow ambiguity
4. Call out the ambiguity clearly in your response when it materially affects implementation

## What Not To Do

- Do not build Stage 2 or Stage 3 features preemptively
- Do not add live chat or retrieval runtime behavior
- Do not add infra purely for future scale
- Do not silently preserve stale downstream artifacts after upstream invalidation
- Do not mutate source PDF, raw words, or canonical source data from downstream editors unless explicitly required
- Do not create alternate admin flows when the config shell already defines the workflow

## Repo Evolution

This file is intentionally repo-agnostic for now because the repository has not been created yet.

Once the repo exists, update this file with:
- actual directory structure
- commands for running frontend/backend/tests
- lint/typecheck/test commands
- migration workflow
- environment variable conventions
- PR / branch workflow
- any concrete monorepo package boundaries
# Spec for config-page-embeddings-v1

branch: claude/feature/config-page-embeddings-v1
figma_component (if used): N/A

## Summary
- Add an Embeddings stage to the existing document configuration workflow.
- This stage lets an operator click a button to generate embeddings for committed document chunks and persist them into PostgreSQL/Supabase.
- Embeddings must be stored in the existing `document_embeddings` table.
- The table uses `(document_id, chunk_index)` as the primary key and stores one vector embedding per committed chunk.
- The stage depends on committed chunks already existing in `document_chunks`.
- The operator flow should be intentionally simple:
  - open the Embeddings stage
  - review current embedding status
  - click a button to generate/store embeddings
  - see success, error, and count/status feedback
- This stage should not introduce manual editing of embeddings.
- If chunks are changed, regenerated, deleted, or invalidated, document embeddings must be treated as stale and regenerated.

## Functional Requirements
- The Embeddings stage must be accessible within the existing config page stage workflow.
- The stage must follow the same shell, stage panel, action panel, status, and navigation patterns used by earlier config page stages.
- The stage must appear after the Chunks stage in the document-processing pipeline.
- The stage must depend on committed chunks existing for the active document.
- If no committed chunks exist for the active document:
  - the Generate/Store Embeddings action must be disabled
  - the UI must clearly explain that chunks must be created and committed first
- The stage must read chunk data from `document_chunks` for the active `document_id`.
- The stage must generate exactly one embedding for each committed chunk row.
- The text sent to the embedding model must come from the committed chunk `text` field.
- The chunk identity used for persistence must be:
  - `document_id`
  - `chunk_index`
- The stage must persist embeddings into the existing `document_embeddings` table:
  - `document_id integer not null`
  - `chunk_index integer not null`
  - `embedding public.vector not null`
- The persisted rows must respect the existing primary key:
  - `(document_id, chunk_index)`
- Re-running embedding generation for the same document must replace/update existing embedding rows for the same `(document_id, chunk_index)` rather than creating duplicates.
- The implementation should use an upsert/replace strategy so repeated button clicks are safe.
- The stage must delete stale embedding rows for the document when the current committed chunk set no longer contains the matching `chunk_index`.
- The final `document_embeddings` rows for a document should exactly match the current committed chunk set after a successful run.
- The stage must not mutate:
  - source PDF
  - raw words
  - canonical words
  - outline nodes
  - document chunks
- The stage must surface status counts in the action panel, including at minimum:
  - total committed chunks
  - number of chunks with stored embeddings
  - number of missing embeddings
  - last generated timestamp if available from existing metadata/state patterns
- The primary action button should be labeled clearly, such as “Generate Embeddings” or “Generate & Store Embeddings”.
- Clicking the primary action must:
  - load the committed chunks for the active document
  - generate embeddings for those chunks
  - store them in `document_embeddings`
  - update the stage status after success
- The UI must support clear states:
  - Not ready: no committed chunks
  - Ready: chunks exist but embeddings are missing or stale
  - Generating
  - Stored / Complete
  - Error
  - Stale: chunks changed after embeddings were generated
- The stage must prevent duplicate concurrent embedding jobs for the same document from a single UI session.
- If the operator clicks the button multiple times rapidly, the second request should be ignored, disabled, or safely handled without duplicate writes.
- The stage must show useful progress feedback while embeddings are being generated.
- For documents with many chunks, generation should be processed in a way that avoids UI freezing and request timeout where possible.
- If embeddings are generated in batches, the UI should still present the result as one coherent stage-level operation.
- If one or more chunks fail during embedding generation, the system must not silently report full success.
- The implementation should choose one of the following failure strategies and keep it consistent:
  - fail the entire run and leave prior committed embeddings unchanged where possible
  - write partial successes but clearly report partial failure and missing chunks
- Preferred behavior for this version: fail the run as a stage-level operation if any chunk embedding fails, and surface the error.
- A successful run should leave the document in a clean, complete embeddings state.
- The stage must reload existing stored embeddings status when revisiting or refreshing the config page.
- Existing embeddings should be detected by counting rows in `document_embeddings` for the current `document_id` and comparing them against committed chunks.
- The stage must mark embeddings as stale when committed chunks change after embeddings were generated.
- If the PDF, raw words, canonical words, or chunks are regenerated in a way that invalidates chunk text or chunk indices, embeddings for the affected document must be purged or marked stale and regenerated.
- If only outline nodes are regenerated and chunks are preserved but assignments are cleared, embeddings should remain valid as long as chunk text and `chunk_index` remain unchanged.
- If chunks are deleted or recreated, embeddings should be recalculated against the new committed chunk rows.
- The feature should not introduce vector search or chatbot retrieval behavior yet.
- This spec only covers generating and storing embeddings.
- Future retrieval/chatbot behavior should consume `document_embeddings` but is out of scope for this stage.

## Figma Design Reference (only if referenced)
- File: N/A
- Component name: N/A
- Key visual constraints:
  - The Embeddings stage should visually match the existing config page shell and action panel style
  - The action panel should make readiness, progress, success, stale, and error states easy to understand
  - The operator should be able to understand at a glance whether embeddings exist for all committed chunks
  - The UI should emphasize that this is a generated technical artifact, not an editable content layer

## Possible Edge Cases
- No committed chunks exist for the document
- `document_chunks` exists but contains zero rows
- Some chunks have empty or whitespace-only text
- Existing embeddings exist for only some chunks
- Existing embeddings exist for chunk indices that no longer exist in `document_chunks`
- Chunk text changes but `chunk_index` remains the same
- Chunk indices are recomputed after a chunks commit
- Operator clicks the Generate Embeddings button multiple times rapidly
- Embedding provider/API request fails
- Embedding provider/API returns a vector with the wrong dimension for the configured `public.vector` column
- Database upsert fails after embeddings are generated
- Network/server timeout occurs during a large document embedding run
- Partial batch failure occurs after some embeddings have been generated
- User navigates away while generation is running
- User refreshes the page while generation is running
- Chunks are regenerated in another session while embeddings are being generated
- Existing stored embeddings are stale but the UI initially loads them as complete
- Supabase/Postgres vector extension is missing or misconfigured in a new environment

## Acceptance Criteria
- The config page includes an Embeddings stage after the Chunks stage
- The Embeddings stage is disabled or blocked until committed chunks exist
- The action panel shows the committed chunk count for the active document
- The action panel shows how many embeddings are currently stored for the active document
- The primary action button generates embeddings from committed chunk text
- Generated embeddings are stored in `document_embeddings`
- Each stored embedding row uses the correct `document_id` and `chunk_index`
- Re-running generation updates/replaces existing rows without creating duplicates
- After a successful run, the number of embedding rows matches the number of committed chunk rows
- Stale embedding rows for missing chunk indices are removed or replaced so the table matches the current chunk set
- The UI shows a generating/loading state while embeddings are being created
- The UI shows a success/complete state after all embeddings are stored
- The UI shows an error state if embedding generation or database persistence fails
- Rapid repeated clicks do not create duplicate jobs or corrupt stored embeddings
- Reloading the page reflects existing stored embedding status correctly
- Changing committed chunks causes embeddings to become stale or be purged according to the stage invalidation rules
- PDF/raw/canonical/chunk invalidation prevents stale embeddings from being treated as current
- Outline-only regeneration does not invalidate embeddings if chunk text and chunk indices remain unchanged
- No source PDF, raw words, canonical words, outline nodes, or chunks are mutated by generating embeddings
- The feature does not implement chatbot retrieval or vector search yet

## Open Questions
- What embedding model should be used for this stage? OpenAI text-embedding-3-small
- Should embeddings be generated client-triggered but server-executed? yes, the button should trigger a backend/server action so API keys and embedding logic stay server-side
- Should re-running generation always regenerate every chunk, or only missing/stale chunks? for V1, regenerate all chunks for the document and replace the stored set
- Should partial embedding failures preserve old embeddings or clear them? prefer preserving old embeddings until the full replacement succeeds, where feasible
- Should there be a dedicated `last_embedded_at` metadata field somewhere? so in the documents table, there are columns that will be relevant for this question, in the following (so basically embeddings_last_generated_at and embedding_model)
create table public.documents (
  id serial not null,
  file_name text not null,
  file_size bigint null default '0'::bigint,
  page_count smallint null default '0'::smallint,
  last_updated_at timestamp with time zone null default now(),
  raw_words_last_generated_at timestamp with time zone null,
  canonical_words_last_generated_at timestamp with time zone null,
  nodes_last_generated_at timestamp with time zone null,
  chunks_last_generated_at timestamp with time zone null,
  embeddings_last_generated_at timestamp with time zone null,
  embedding_model text null,
  source_pdf_last_updated_at timestamp with time zone null,
  constraint documents_pkey primary key (id),
  constraint documents_name_key unique (file_name)
) TABLESPACE pg_default;

- Should the stage store embedding model/version metadata? it should, in the documents table within the column embedding_model
- Should empty chunks be skipped or embedded? empty or whitespace-only chunks should be blocked as invalid chunk data and surfaced as an error
- Should embeddings be purged immediately when chunks change, or just marked stale until regeneration? it should purge
- Should generation support background jobs for very large documents? not required for V1, but the implementation should avoid obvious timeout risks where reasonable

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Embeddings stage is blocked when no committed chunks exist
- Embeddings stage loads committed chunk count correctly
- Embeddings stage loads existing embedding count correctly
- Generate action sends committed chunk text to the embedding generation path
- Successful generation writes one row per chunk into `document_embeddings`
- Stored rows use correct `document_id` and `chunk_index`
- Re-running generation updates/replaces existing embedding rows without duplicates
- Stale embedding rows for removed chunk indices are cleaned up or no longer treated as valid
- UI shows generating state while generation is in progress
- UI shows complete state when all chunks have embeddings
- UI shows missing/stale state when chunk count and embedding count do not match
- UI shows error state when embedding provider fails
- UI shows error state when database persistence fails
- Rapid repeated button clicks do not start duplicate unsafe writes
- Empty or whitespace-only chunk text blocks generation with a clear error
- Reloading the page reflects stored embedding status correctly
- Chunk regeneration invalidates or purges embeddings for the document
- Outline-only regeneration keeps embeddings valid when chunk text and indices are unchanged

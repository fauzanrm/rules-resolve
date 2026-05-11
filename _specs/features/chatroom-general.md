# Spec for chatroom-ask-mvp

branch: claude/feature/chatroom-general
figma_component (if used): N/A

## Summary
- Add the MVP user-facing Ask/Chatroom experience for published chatrooms.
- From the homepage, the chatroom of each board game can be access throught the 'Ask' button
- The Ask action should only be available for chatrooms that are published.
- Entering Ask opens a chatroom page where the user can ask questions about that chatroom's published document content.
- Answers must be generated through the connected OpenAI model and grounded only in the stored embeddings/chunks for documents attached to that chatroom.
- Retrieval must use the Postgres-backed `document_embeddings` table in supabase (postgres)
- Answers must include citations based on actual document text.
- Each answer may include a maximum of 3 citations.
- Each citation must be tied to a retrieved chunk, but the visible citation text may be a smaller subset of words within that chunk.
- The chatroom page must include a PDF viewer on the left and chat UI on the right.
- Clicking a citation must scroll the PDF viewer to the relevant page, highlight the cited words, and center the highlight vertically in the viewer when possible.
- This feature should reuse only the minimal useful ideas from the existing reference chat/highlight files and avoid recreating the full older demo/upload chat system.
- There should be indicies on each citation for a response. and then there should be inline numbers in the responses that corresponds to the citation like 'some statement [1]' whereby the 1 corresponds to the first citation

## Functional Requirements

### 1. Homepage entry behavior
- The chatroom should be accessible through the Ask button in each board game card
- Ask must only be enabled when the chatroom is published.
- A chatroom is considered published when its `published_at` value is present.
- If `published_at` is null, missing, or invalid, the Ask action must be disabled or hidden.
- The disabled Ask state should make clear that the chatroom is not published yet.
- The frontend must not rely only on disabled UI for access control.
- The Ask backend endpoint must also reject requests for unpublished chatrooms.

### 2. Ask route and page shell
- Add a route for asking a specific chatroom, using the chatroom id from the database.
- The route should be under the existing app routing pattern and should not create a parallel standalone demo flow.
- The Ask page must load chatroom metadata by `chatroom_id`.
- The Ask page must verify that the chatroom is published before loading chat functionality.
- If the chatroom is unpublished, missing, or unavailable, the page must show a safe unavailable state instead of opening chat.
- The Ask page layout must be split into two primary areas:
  - Left: PDF viewer
  - Right: chat panel
- The PDF viewer should take enough width to make citations and highlights usable.
- The chat panel should include:
  - message list
  - input box
  - send action
  - loading state while an answer is being generated
  - answer citations rendered as clickable UI elements
- The Ask page should include a simple way to navigate back to the homepage.

### 3. Published document scope
- Chat responses must only use documents attached to the active chatroom through the existing chatroom-document relationship.
- For MVP, retrieval may assume one primary published document per chatroom if that is the current app state.
- The data model and API shape should not hard-code a single-document future if the chatroom can eventually contain multiple documents.
- If multiple documents are attached to a chatroom, retrieval must limit itself to documents associated with that chatroom.
- The answer must not use chunks or embeddings from documents outside the active chatroom.
- If the chatroom has no attached documents with embeddings, the UI must show a clear unavailable state or answer-level fallback.

### 4. Chat message behavior
- The user must be able to type a question and submit it.
- On submit, the UI must immediately append the user message to the conversation.
- While waiting for the answer, the UI must show an assistant loading state.
- On success, the UI must append the assistant answer.
- On failure, the UI must append or show a calm error state that lets the user try again.
- The chat should preserve the current page/session's conversation state while the user remains on the Ask page.
- Persistent conversation history is not required for this MVP unless already simple to reuse.
- The chat input must prevent duplicate rapid submissions while a response is in flight.
- Empty or whitespace-only questions must not be submitted.

### 5. Retrieval source of truth
- The backend must retrieve relevant chunks from Postgres using `document_embeddings`.
- The implementation must not use ChromaDB for this MVP.
- Query embedding must be generated using the same embedding model family/dimensions used when `document_embeddings` were created.
- Retrieval must filter by the active chatroom's associated document ids.
- Retrieval must return chunk-level data needed for answer generation and citation mapping, including at minimum:
  - `document_id`
  - `chunk_id` or `chunk_index`
  - chunk text
  - retrieval score / similarity distance
  - canonical word start/end index if available
  - page information or enough metadata to derive page information
- Retrieval should use a top-k large enough to provide context, but answer citations must still be capped to 3.
- If retrieval returns no useful chunks, the answer should say that there is not enough information in the document to answer.

### 6. Answer generation through OpenAI
- The answer-generation endpoint must call the connected OpenAI model.
- The model prompt must instruct the assistant to answer only from retrieved context.
- The model prompt must instruct the assistant not to invent rules, sources, or page references.
- The model prompt must allow the assistant to say that the answer is not available in the document.
- The model prompt must require citation support for grounded claims.
- The response should be concise, useful, and specific to the user's question.
- The model should receive prior conversation history only as secondary context.
- Retrieved document context must remain the source of truth over conversation history.
- If conversation history conflicts with retrieved document context, the answer must follow the retrieved document context.

### 7. Citation generation and validation
- Each assistant answer may include a maximum of 3 citations.
- Citations must be generated from retrieved chunks only.
- Each citation must be tied to a specific source chunk.
- The visible citation text may be a subset of words inside that source chunk.
- Citation text must not contain words that are not present in the source chunk, except for harmless whitespace normalization.
- Each citation must include enough metadata for frontend navigation and highlighting:
  - citation id / index
  - `document_id`
  - source `chunk_id` or `chunk_index`
  - cited text preview
  - start word identity or canonical start index, if available
  - end word identity or canonical end index, if available
  - page number
  - bounding boxes or word quad data needed to highlight the cited words
- Citation validation must happen server-side before returning the answer.
- If the model proposes citations that cannot be mapped to source chunks/words, those citations must be dropped or repaired.
- If no valid citations can be produced, the answer should still be returned only if it is grounded in retrieved chunks, but the UI should not display fake citations.
- The answer response payload should separate answer text from citation metadata instead of relying only on inline citation markers.
- Inline citation markers may be used in the displayed answer if helpful, but the canonical citation metadata must come from structured response fields.

### 8. Citation-to-word mapping
- The system must support mapping citation text back to actual document words.
- Preferred mapping should use canonical word identities or canonical index spans when available.
- If a citation is a subset of a chunk, the backend must identify the corresponding word range inside that chunk.
- Citation spans should be derived deterministically from chunk text and canonical word mapping, not guessed by the frontend.
- If exact word-span mapping fails for a citation subset, the backend may fall back to highlighting the full source chunk for MVP.
- Full-chunk fallback must be explicitly represented in citation metadata so the frontend knows the highlight is chunk-level rather than exact citation-level.
- The frontend must be able to render both exact citation highlights and full-chunk fallback highlights.

### 9. PDF viewer behavior
- The Ask page must render the active document PDF in the left-side viewer.
- The viewer should use the already committed source PDF for the document.
- If multiple documents are attached, MVP may display the first/primary document by default, but citation clicks must be able to switch/focus the correct document if citations come from another attached document.
- The viewer must support programmatic navigation to a page.
- The viewer must support rendering a highlight overlay from citation metadata.
- The viewer must support clearing/replacing the active highlight when a different citation is clicked.
- Highlight overlays must align with the PDF page scaling.
- Highlight overlays should remain readable and should not obscure the text.

### 10. Citation click behavior
- Each rendered citation in an assistant message must be clickable.
- Clicking a citation must:
  - select that citation as active
  - navigate the PDF viewer to the citation's page
  - render a highlight over the cited words or fallback chunk span
  - scroll the viewer so the highlight is vertically centered when possible
- If the citation page is already visible, the viewer should still center and highlight the relevant words.
- If the citation metadata is incomplete, clicking should safely navigate to the page if possible and avoid crashing.
- If the page or PDF cannot be found, the UI should show a small non-blocking error state.

### 11. API response shape
- The chat query endpoint must return a structured response with at minimum:
  - `answer`
  - `citations`
  - optional `retrieved_chunks` for debug/developer inspection if needed
  - optional `log_id` if logging already exists or is easy to support
- Each citation object must include at minimum:
  - citation index
  - source document id
  - source chunk id / chunk index
  - cited text
  - page number
  - highlight mode: `word_span` or `chunk_span`
  - word/canonical span or bbox/quad data needed by the viewer
- The frontend should not parse raw answer text to discover citation metadata.
- The frontend may use inline citation indices to connect displayed text to structured citation objects.

### 12. Logging and observability
- The backend should log each chat request at a minimal level useful for debugging.
- Logs should include:
  - chatroom id
  - document ids searched
  - number of retrieved chunks
  - number of returned citations
  - whether answer generation succeeded or failed
- Logs must not expose secrets or API keys.
- Storing full user questions and answers is optional for MVP and should follow the existing project conventions if logging already exists.

### 13. Reference implementation boundaries
- The existing reference chat and highlight files may be used as design inspiration only.
- Keep useful MVP concepts such as:
  - local message state
  - loading state
  - structured citation objects
  - citation click leading to highlight state
- Do not carry over demo-only behavior such as:
  - preloaded game-specific responses
  - preset routes
  - upload-session-specific chat flows
  - ChromaDB retrieval assumptions
  - Claude-specific service assumptions
- The new implementation should align with the current app's Postgres/Supabase/OpenAI architecture.

## Figma Design Reference (only if referenced)
- File: N/A
- Component name: N/A
- Key visual constraints:
  - Two-panel Ask layout: PDF viewer on the left, chat on the right
  - Citations should be clearly clickable but not visually noisy
  - Active citation state should be visible in both the chat panel and PDF viewer
  - PDF highlight should be legible and centered after citation click
  - Unpublished/unavailable states should feel calm and explain why chat cannot be opened

## Possible Edge Cases
- User navigates directly to an unpublished chatroom Ask URL.
- Ask button is disabled on homepage but user manually enters the Ask route.
- Published chatroom has no associated documents.
- Published chatroom has documents but no committed chunks.
- Published chatroom has chunks but no embeddings in `document_embeddings`.
- `document_embeddings` were generated with a different embedding model/dimension than the query embedding.
- Retrieval returns chunks from the wrong document if filtering is incomplete.
- Retrieval returns low-confidence or irrelevant chunks.
- User asks a question not answered in the document.
- OpenAI call fails or times out.
- The answer model returns unsupported or invalid citations.
- Citation text cannot be mapped exactly to a word span inside the source chunk.
- Citation maps to a chunk that spans multiple pages.
- Citation click occurs before the PDF page has finished rendering.
- PDF highlight coordinates do not align after zoom/resizing.
- Multiple citations point to the same page and overlapping word regions.
- User submits another question while a response is loading.
- User refreshes the page and local chat state is lost.
- Multiple documents are attached to one chatroom but only one viewer is visible.
- A chatroom is unpublished while a user already has the Ask page open.
- Embeddings are regenerated while a chat response is in flight.

## Acceptance Criteria
- Homepage shows Configure and Ask entry points for chatrooms.
- Ask is only enabled for chatrooms with `published_at` present.
- Direct Ask route access is blocked for unpublished chatrooms.
- Published chatroom Ask page loads with a left PDF viewer and right chat panel.
- User can submit a question and see their message added to the conversation.
- Backend retrieves context from Postgres `document_embeddings` filtered to the active chatroom's documents.
- Backend does not use ChromaDB for this MVP chat retrieval.
- Backend calls the connected OpenAI model to generate the answer.
- Answer is grounded only in retrieved document chunks.
- If the answer is not available in the document, the assistant says so instead of guessing.
- Assistant responses include no more than 3 citations.
- Every returned citation is tied to a retrieved source chunk.
- Citation text is either an exact word-span subset of the chunk or an explicitly marked full-chunk fallback.
- Citation metadata includes page and highlight information needed by the PDF viewer.
- Frontend renders citations as clickable elements in assistant messages.
- Clicking a citation scrolls the PDF viewer to the correct page.
- Clicking a citation highlights the cited words or fallback chunk span.
- Highlight is vertically centered in the PDF viewer when possible.
- Chat gracefully handles retrieval, OpenAI, and citation-mapping failures.
- The implementation reuses only minimal useful concepts from the reference chat/highlight files and avoids demo/upload-specific behavior.

## Open Questions
- Should the Ask route be `/ask/[chatroomId]`, `/chatrooms/[chatroomId]/ask`, or another route consistent with the current app structure? it should be chatroomId/ask for now
- For chatrooms with multiple published documents, should MVP search all attached embedded documents or only a primary document? we currently don't have multiple documents so no need to worry about that for now. but respect that it may be implemented for that in the future
- Is there already a `document_id` to source-PDF path resolver the viewer should use, or should this feature add one minimal endpoint?
  Yes — GET /config/{chatroom_slug} returns a signed Supabase URL for the source PDF (via _build_document_meta() in routers/config.py). The path pattern it uses is exactly
  {chatroom_id}/documents/{doc_id}/source/{file_name}. The Ask page can reuse this endpoint rather than adding a new one, since it already returns the active document and signed PDF URL for a chatroom.
- Does `document_embeddings` currently store `chunk_index` only, or does it also store a direct `chunk_id` reference?
  chunk_index only. The table is (document_id, chunk_index, embedding vector(1536)) with a composite PK of (document_id, chunk_index). No chunk_id column.
- Are chunk text and canonical index spans fetched by joining `document_embeddings` to `document_chunks`, or are they duplicated in the embeddings table? Joined. Text and spans (start_canonical_index, end_canonical_index) live only in document_chunks. Retrieval joins embeddings to chunks on (document_id, chunk_index), then returns document_chunks.id as the
   stable chunk_id for citations.
- Where is the canonical source for word-level quads during Ask: `document_canonical_words`, raw/canonical JSON in storage, or another table? document_canonical_words.quad column — stored as a JSON array [x0, y0, x1, y1] in Postgres. That's the only coordinate storage; there's no separate bbox table or raw JSON file used for quads.
- Should exact citation highlighting require canonical word spans for MVP, or is full-chunk fallback acceptable when exact mapping is not available? canonical word spans is expected
- Should chat history persist to Postgres in this MVP, or remain local/session-only? local session only, but will have the db for it later
- Should answer text include inline citation chips, footnote-style citation buttons, or both? citation chips
- What is the maximum context size/top-k retrieval count for the OpenAI prompt? i defer to you on this

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Homepage Ask action is enabled for published chatrooms.
- Homepage Ask action is disabled or hidden for unpublished chatrooms.
- Direct Ask route access for an unpublished chatroom shows a blocked/unavailable state.
- Published Ask page renders PDF viewer and chat panel.
- Submitting a valid question appends a user message and triggers the chat query endpoint.
- Empty or whitespace-only questions cannot be submitted.
- Duplicate submit is blocked while a response is loading.
- Retrieval query filters `document_embeddings` by active chatroom document ids.
- Retrieval does not return chunks from unrelated chatrooms/documents.
- No-embedding state returns a clear unavailable/not-enough-information response.
- OpenAI answer generation receives only retrieved context plus allowed conversation history.
- Unknown-answer questions produce the expected not-enough-information response.
- Returned citations are capped at 3.
- Returned citations are tied to retrieved chunk ids.
- Citation validation drops or repairs citations that cannot be mapped to retrieved chunks.
- Citation text maps to a word-span subset of the source chunk when possible.
- Full-chunk fallback is marked when exact word-span mapping fails.
- Frontend renders assistant response with clickable citations.
- Clicking a citation calls viewer navigation with the correct page number.
- Clicking a citation renders the expected highlight overlay.
- Highlight remains aligned after viewer resize or zoom.
- Citation click gracefully handles missing bbox/quad metadata.
- Backend failure shows a retry-safe error state in the chat UI.

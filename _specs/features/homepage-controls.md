# Spec for homepage-controls

branch: claude/feature/homepage-controls
figma_component (if used): none

## Summary
- Add a publish workflow to the admin Config Page so an admin can publish a chatroom only after all document-processing stages through embeddings are complete.
- Update admin homepage chatroom cards/chips so each chatroom has two explicit actions:
  - Configure
  - Ask
- The Configure action opens the existing chatroom Config Page.
- The Ask action is disabled until the chatroom has been published.
- Publishing a chatroom activates the Ask action for that chatroom.
- The Ask destination is a placeholder page for now that displays a “Coming soon” message and includes a back button to return to the main admin chatrooms page.
- Add a compact stage-completion indicator to each chatroom card/chip so admins can quickly see which processing steps are complete, pending, or in progress/staged.
- Stage indicators should support hover tooltips that explain the step represented by each indicator.

## Functional Requirements

### 1. Publish gating on the Config Page
- The Config Page must include a clear publish action for the current chatroom.
- The publish action should only be enabled when all required stages are complete through embeddings.
- Required stages for publishing are:
  - PDF Upload
  - Raw Words Detection
  - Canonical Words Selection
  - Outline Generation / Nodes
  - Chunk Assignment
  - Embeddings Generation
- If any required stage is incomplete, stale, invalidated, or has uncommitted changes, the publish action must be disabled.
- The disabled publish state should explain what still needs to be completed before publishing.
- The publish action should not regenerate or modify any stage outputs by itself.
- Publishing should mark the chatroom as published in persistent storage.
- Publishing should store a timestamp such as `published_at` if the schema supports it or if this feature adds it.
- Publishing should be reversible only if explicitly supported by this feature. For this version, no unpublish action is required.

### 2. Publish state persistence
- The system must persist whether a chatroom is published.
- The published state must survive page refreshes and reloads.
- The published state must be reflected consistently on:
  - the Config Page
  - the admin homepage chatroom card/chip
  - the Ask action gating logic
- If upstream document-processing stages are later invalidated after a chatroom was already published, the system must prevent stale published access.
- Preferred behavior for this version:
  - if any required stage becomes stale or incomplete after publishing, the chatroom should no longer be considered ask-ready
  - the Ask button should become disabled again
  - the Config Page should show that the chatroom needs to be republished after the pipeline is restored
- The UI should distinguish between:
  - never published
  - published and ask-ready
  - previously published but now stale / needs republish

### 3. Admin homepage card/chip actions
- Each chatroom card/chip on the admin homepage must show two actions:
  - Configure
  - Ask
- Configure must always be available for admin users.
- Clicking Configure must navigate to the existing Config Page for that chatroom.
- Ask must be disabled unless the chatroom is currently published and all required stages are still complete/fresh.
- When Ask is disabled, the UI should make the disabled state obvious but not noisy.
- Disabled Ask should provide a hover tooltip or helper text indicating why it is unavailable, such as:
  - “Complete all processing steps and publish this chatroom first.”
  - “This chatroom needs to be republished because configuration changed.”
- When Ask is enabled, clicking it must navigate to the chatroom Ask placeholder page.

### 4. Ask placeholder page
- Add an Ask route/page for a specific chatroom.
- The Ask page should be accessible only through the enabled Ask button for now.
- The Ask page should display a simple placeholder state such as:
  - “Coming soon”
- The page should include a clear back button.
- Clicking the back button must return the admin to the main admin chatrooms page.
- The Ask placeholder should not include real chatbot, retrieval, or answer-generation behavior yet.
- The page should preserve the broader admin visual language where practical.

### 5. Stage-completion indicator on chatroom cards/chips
- Each chatroom card/chip must show a compact visual indicator for the required processing stages.
- The indicator should make it possible to understand progress at a glance without opening the Config Page.
- The indicator can be represented as dots, small bars, segmented lines, or another compact equivalent.
- Each segment must correspond to one required stage:
  - PDF Upload
  - Raw Words
  - Canonical Words
  - Nodes / Outline
  - Chunks
  - Embeddings
- Indicator colors should represent status:
  - gray: not started / missing / incomplete
  - yellow: staged, dirty, in progress, or needs attention
  - green: completed and fresh
- If a stage is stale due to upstream invalidation, it should not appear as green.
- Stale can use yellow if no separate stale color is introduced.
- Hovering over each dot/bar/segment must show a tooltip with:
  - stage name
  - current status
  - optional short explanation if not complete
- The indicator should be visible without overpowering the chatroom name and cover image.
- The indicator should still render cleanly if stage status data fails to load or is partially unavailable.

### 6. Stage status source of truth
- Stage status should be derived from persisted document-processing state, not only from client-side UI state.
- A stage should count as complete only when its committed output exists and is fresh relative to upstream dependencies.
- A stage should count as yellow / staged if there are known uncommitted local changes or a backend status indicating processing or attention required.
- A stage should count as gray if no committed output exists.
- The embeddings stage must be included as a first-class required stage for publish readiness.
- The publish readiness calculation should be centralized or shared so the Config Page and homepage do not drift.

### 7. Interaction and visual behavior
- The Configure and Ask actions should feel like peer actions, but Configure should remain the primary admin maintenance path.
- Ask should not look like a broken button when disabled.
- Published state should be legible, such as a small “Published” / “Ready” badge when ask-ready.
- A stale published chatroom should show a warning-style state such as “Needs republish” rather than pretending to be ready.
- The homepage should remain scannable even with many chatrooms.
- The feature should reuse existing homepage-admin card/chip styling where possible.

## Figma Design Reference (only if referenced)
- File: none
- Component name: none
- Key visual constraints:
  - Keep the homepage chatroom card/chip compact and scannable.
  - Configure and Ask should be clearly separated actions.
  - Disabled Ask should be visibly disabled but still readable.
  - Stage indicators should feel like a small dashboard strip, not a second navigation system.
  - Green / yellow / gray status should be easy to distinguish.
  - Tooltips should be lightweight and useful, not large popovers.
  - The Ask placeholder page should be simple and intentionally unfinished.

## Possible Edge Cases
- Chatroom has no document yet.
- Chatroom has a PDF uploaded but no downstream stages completed.
- All stages except embeddings are complete.
- Embeddings exist but are stale because chunks or upstream data changed.
- A chatroom was published, then an upstream stage was regenerated.
- A chatroom was published, then the PDF was replaced.
- A stage has committed output but missing metadata needed to determine freshness.
- Homepage loads before stage status calculation finishes.
- Stage status calculation fails for one chatroom but succeeds for others.
- User clicks Ask while publish status changes concurrently.
- User opens Ask route directly for an unpublished or stale chatroom.
- User publishes while another process is regenerating a stage.
- User has uncommitted changes on the Config Page and tries to publish.
- Long chatroom names make card actions or indicators cramped.
- Tooltip text overlaps card boundaries or viewport edges.
- Multiple documents per chatroom exist in the future, even if current flow assumes one active document.

## Acceptance Criteria
- Config Page shows a publish action for the current chatroom.
- Publish action is disabled until PDF Upload, Raw Words, Canonical Words, Nodes, Chunks, and Embeddings are complete and fresh.
- Disabled publish state tells the admin which stage(s) are blocking publish readiness.
- Clicking publish persists the chatroom as published / ask-ready.
- Published state persists across reloads.
- Admin homepage chatroom cards/chips show both Configure and Ask actions.
- Configure navigates to the chatroom Config Page.
- Ask is disabled before publish readiness is achieved.
- Ask becomes enabled after the chatroom is published and all required stages are complete/fresh.
- Clicking enabled Ask navigates to the Ask placeholder page.
- Ask placeholder page displays “Coming soon” or equivalent placeholder copy.
- Ask placeholder page includes a back button to return to the main admin chatrooms page.
- Each chatroom card/chip shows a compact stage-completion indicator.
- Stage indicator includes one segment for each required stage.
- Stage segment colors reflect gray / yellow / green states correctly.
- Hovering a stage segment shows the stage name and status.
- If a published chatroom becomes stale due to upstream changes, Ask becomes disabled again and the UI indicates republish is needed.
- Direct access to an unpublished or stale Ask route does not expose a real chat experience.

## Open Questions
- Should the persisted field be `published_at`, `is_published`, or both? should just be published at
- Should there be a future unpublish action, or should publishing only be invalidated by stale upstream changes for now? unpublish should automatically happen when embeddings become outdated/stale (which basically means when any prior stage is regenerated)
- Should stale published chatrooms keep a visible “Published” badge plus “Needs republish,” or only show “Needs republish”? It should just say unpublished
- Should yellow represent both “in progress” and “stale,” or should stale use a separate color/icon? there shouldn't be any stale actually, just staged. using yellow
- Should the tooltip include timestamps for completed stages, or only stage name and status? include timestamp too, infact all the stages should now store timestamp, I've added the appropriate columns in the document table in supabase
- Should publishing require a confirmation modal, or is a direct button click acceptable for this internal admin flow? yes, a confirmation modal will be necessary, it's a big step
- Should Ask route direct access redirect back to admin homepage when unpublished, or show a blocked placeholder state? the Ask button should deactivate when the status of the chatroom becomes unpublished
- If multiple documents are eventually attached to one chatroom, should publish readiness require all documents or only the active/default document? ultimately should require all documents to get to the valid embedinggs stage

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Publish button renders on the Config Page.
- Publish button is disabled when any required stage is incomplete.
- Publish button is enabled only when all required stages through embeddings are complete and fresh.
- Disabled publish state identifies blocking stages.
- Publishing persists published / ask-ready state.
- Published state reloads correctly after refresh.
- Homepage chatroom card renders Configure and Ask actions.
- Configure action routes to the existing Config Page.
- Ask action is disabled before publish readiness.
- Ask action is enabled after successful publish.
- Enabled Ask routes to the Ask placeholder page.
- Ask placeholder page renders “Coming soon” and a working back button.
- Stage indicator renders one segment per required stage.
- Stage indicator maps incomplete stages to gray.
- Stage indicator maps staged / dirty / stale stages to yellow.
- Stage indicator maps completed fresh stages to green.
- Stage indicator tooltip shows correct stage name and status.
- Upstream invalidation after publish disables Ask and shows republish-needed state.
- Direct navigation to Ask for an unpublished or stale chatroom is safely blocked or redirected according to the chosen behavior.

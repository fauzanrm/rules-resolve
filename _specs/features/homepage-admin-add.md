# Spec for homepage-admin-add

branch: claude/feature/homepage-admin-add
figma_component (if used): none

## Summary
- Add a new “Add New Chatroom” card to the admin homepage.
- The card should be visually similar in size and styling to existing chatroom chips/cards so it feels like part of the same grid.
- Clicking the card should open a modal/pop-up that allows the admin to:
  - enter a chatroom name
  - upload a PDF
- Saving should create all required records in PostgreSQL and create the corresponding storage structure in Supabase.
- The flow should create:
  - a new chatroom record
  - a new document record
  - a new chatroom-document association record
  - a new storage path for the uploaded source PDF and derived first-page cover image
- This feature should build on top of the existing homepage-admin implementation and its existing styling/layout conventions.

## Functional Requirements
- On the admin homepage, display an additional card in the chatroom list/grid for creating a new chatroom.
- The add-new card should:
  - match the approximate size and visual weight of existing chatroom cards/chips
  - be clearly distinguishable as an action card rather than a normal chatroom
  - contain the label “Add New Chatroom”
- Clicking the add-new card should open a modal/pop-up.
- The modal should contain:
  - a text input for chatroom name
  - a PDF file upload input
  - a cancel action
  - a save/create action
- The save/create action should only succeed when:
  - a valid chatroom name has been provided
  - a PDF file has been selected
- On successful save, the system should create a new chatroom record in PostgreSQL.
- The new chatroom record should include at minimum:
  - a newly generated identifier
  - a display/index ordering value as required by the current schema/pattern
  - the chatroom name
  - standard audit fields if already used elsewhere in the app
- On successful save, the system should create a new document record in PostgreSQL.
- The new document record should include at minimum:
  - a newly generated identifier
  - a display/index ordering value as required by the current schema/pattern
  - the original uploaded filename
  - file size
  - page count
  - last updated timestamp
- The document metadata flow should reuse existing helper/util logic where already available for:
  - file size extraction
  - page count extraction
  - last updated handling
- On successful save, the system should create a chatroom-document association record.
- The association record should connect:
  - the newly created chatroom
  - the newly created document
- The feature should create the storage structure for the new chatroom/document in Supabase storage.
- Storage should follow the established structure:
  - `chatrooms/<chatroom_id>/documents/<document_id>/source/`
  - `chatrooms/<chatroom_id>/documents/<document_id>/derived/`
- Within source storage, the following files should be created:
  - the uploaded original PDF
  - a `.webp` cover image generated from the first page of the PDF
- The original PDF should be stored under the source directory using the agreed source-file naming convention from the document storage flow.
- The generated first-page cover image should also be stored under source using the agreed cover naming convention from the document storage flow.
- The system must not derive storage paths from chatroom names or uploaded filenames alone.
- Storage paths must be based on canonical ids such as:
  - chatroom id
  - document id
- If storage upload fails after database creation has started, the flow should not silently leave the system in a misleading partial state.
- The implementation should define and follow one consistent strategy for failure handling, such as:
  - transactional rollback where possible
  - compensating cleanup for partially created database/storage records
  - explicit surfaced error state if cleanup cannot fully complete
- After successful creation:
  - the modal should close
  - the homepage should refresh or update locally
  - the newly created chatroom should appear in the chatroom list
- If cover image metadata/path is part of chatroom display on the homepage, the new chatroom card should use the newly generated first-page `.webp` asset after creation.
- The flow should respect the existing homepage-admin layout and patterns rather than introducing a separate creation page.
- The modal should be simple and internal-tool oriented, consistent with the rest of the admin UI.

## Figma Design Reference (only if referenced)
- File: none
- Component name: none
- Key visual constraints:
  - The add-new card should feel like part of the same chatroom grid
  - The add-new card should not visually overpower real chatroom cards
  - The modal should be compact, clear, and optimized for a short admin workflow
  - The form should clearly separate chatroom naming from PDF upload
  - Loading, disabled, and error states should be legible but minimal
  - The experience should remain easy to adapt later if more setup fields are added

## Possible Edge Cases
- User opens the modal and cancels without entering anything
- User enters a chatroom name but does not upload a PDF
- User uploads a non-PDF file / in this case, it should throw an error
- User uploads a corrupted PDF / in this case it shoudl throw an error
- PDF page count extraction fails
- Cover image generation from first page fails
- Chatroom record is created but document record creation fails
- Chatroom and document records are created but association record creation fails
- Database creation succeeds but storage upload fails
- Source PDF uploads successfully but cover image generation/upload fails
- Duplicate chatroom names are submitted
- Uploaded PDF filename is unusually long or contains special characters
- Very large PDF file causes timeout or upload failure
- User clicks save multiple times rapidly
- Modal is closed while creation is in progress
- Homepage refresh succeeds but newly created card metadata is stale or incomplete
- Database index ordering logic conflicts with existing records
- Storage bucket/folder exists logic behaves unexpectedly for a newly created path

## Acceptance Criteria
- The homepage includes an “Add New Chatroom” card in the same general visual system as the chatroom cards
- Clicking the add-new card opens a modal/pop-up
- The modal allows the admin to enter a chatroom name and upload a PDF
- The save action is blocked until both a valid name and PDF are present
- Saving creates a new chatroom record in PostgreSQL
- Saving creates a new document record in PostgreSQL with filename, file size, page count, and last updated metadata
- Saving creates a chatroom-document association record linking the new chatroom and new document
- Saving creates the expected storage structure under the new chatroom/document ids
- The uploaded PDF is stored in the source directory
- A `.webp` image of the first PDF page is generated and stored in the source directory
- The feature does not rely on chatroom-name-derived storage paths
- After success, the modal closes and the new chatroom appears on the homepage
- Failures during creation do not leave the UI in a false-success state
- The feature is implemented as part of the homepage-admin flow and respects its existing styling/patterns

## Open Questions
- Should chatroom name be required to be unique, or can duplicate names exist? duplicate names can't exist
- What exact schema fields define the “index” for chatrooms and documents in the current database? well for chatrooms it's a s simple as id(int4), name(text), last_updated_at(timestamptz), for documents it's id, file_name, file_size, page_count, last_updated_at
- Should creation use strict database transaction semantics, or is compensating cleanup acceptable if storage operations fail? strict database transactions please
- What is the exact canonical filename for:
  - the source PDF / i guess it should be *.pdf <- whatever name I upload with
  - the generated `.webp` cover / it shoudl be just cover.webp
- If cover generation fails but the PDF upload succeeds, should the entire creation fail or should the chatroom be created with a fallback no-cover state? fallback with no-cover state
- Should the new chatroom be inserted alphabetically on the homepage immediately, or simply appended and re-sorted by the existing homepage logic? just appended and use existing logic
- Should the modal support drag-and-drop upload, or just a standard file picker for now? should support standard file picker is fine for now
- Should there be file size limits or PDF page limits enforced at upload time? 25 MB for the pdf

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Render test confirming the add-new chatroom card appears on the homepage
- Interaction test confirming clicking the add-new card opens the modal
- Validation test confirming save is blocked without a chatroom name
- Validation test confirming save is blocked without a PDF upload
- Validation test confirming non-PDF files are rejected
- Success-path test confirming chatroom, document, and association creation are all triggered
- Metadata test confirming filename, file size, page count, and last updated values are populated correctly
- Storage test confirming the expected chatroom/document source and derived paths are created
- Upload test confirming the original PDF is stored in source
- Cover-generation test confirming the first-page `.webp` is created and stored
- Failure test confirming a database/storage failure surfaces an error and does not show false success
- Post-success UI test confirming the modal closes and the new chatroom appears in the homepage list
# Spec for config-page-raw-words-v1

branch: claude/feature/config-page-raw-words-v1
figma_component (if used): existing config page shell

## Summary
- Extend the existing config page shell to support the raw words stage.
- Allow operators to:
  1. Generate raw words from the source PDF
  2. Visually inspect word-level quads in the viewer
  3. Commit the generated raw words to storage
- This stage is intentionally minimal and scoped to:
  - generation
  - visualization
  - commit
- No editing, canonicalization, or downstream processing is included in this stage.

---

## Functional Requirements

### 1. Config Page Shell Integration
- All behavior must **respect and build on top of the existing config-page-shell implementation and specs**:
  - Navigation (homepage-admin → chatroom chip → config page)
  - Layout structure
  - State management patterns
  - Back/navigation handling
- Do not introduce parallel flows or alternate entry points.
- All controls (generate, commit, status) must live within the existing shell paradigm.

---

### 2. Source PDF Dependency
- This stage depends on the existence of:
  - `source/original.pdf`
- If the source PDF does not exist:
  - Raw word generation must be disabled
  - UI must clearly indicate that PDF upload is required first

---

### 3. Raw Words Generation
- Provide an explicit action: **Generate Raw Words**
- Generation must:
  - Read from `source/original.pdf`
  - Produce a JSON payload structured like the attached example
- Each word object must include:
  - `word_id`
  - `text`
  - `quad` (bounding box coordinates)
  - `page`
  - `block_no`
  - `line_no`
  - `word_no`
  - Optional metadata (e.g. font info) when available :contentReference[oaicite:0]{index=0}
- Generation replaces the current in-memory working set (no merging)

---

### 4. Viewer + Quad Rendering
- The PDF viewer must:
  - Render the source PDF
  - Overlay word-level quads on top of each page
- Quads must:
  - Align correctly with PDF scaling and pagination
  - Be rendered for all generated words
- Visualization is **read-only** for this stage

---

### 5. Working vs Committed State
- The system must clearly distinguish between:
  - **Committed raw words**
  - **Generated (uncommitted) raw words**
- After generation:
  - State is marked as **dirty / uncommitted**
  - UI must clearly indicate:
    - “Generated, not yet committed”

---

### 6. Commit Flow
- Provide an explicit action: **Commit Changes**
- On commit:
  - Persist raw words JSON to:
    - `derived/raw_words/latest.json`
  - Overwrite the previous version (single-version model)
- After successful commit:
  - Generated state becomes the new committed baseline
  - Dirty state resets

---

### 7. Navigation & Unsaved Changes
- Must respect navigation patterns defined in config-page-shell
- If uncommitted changes exist:
  - Navigating away (back, navbar, home) must trigger a warning
- If no uncommitted changes:
  - Navigation proceeds normally

---

### 8. Stage Dependency & Invalidation (CRITICAL)
- Raw words stage is **strictly dependent** on the source PDF stage
- If the source PDF is:
  - Deleted
  - Replaced
  - Modified in any way

Then:
- The raw words stage must be **automatically invalidated and purged**
  - Delete:
    - `derived/raw_words/latest.json`
- UI must reset to:
  - No committed raw words
  - No generated state
- User must:
  - Re-upload / confirm PDF
  - Re-run raw word generation from scratch

- There must be **no scenario** where raw words persist against a stale or mismatched PDF

---

### 9. Status States
The UI must support clear states:
- Idle (no raw words yet)
- Generating
- Generated (uncommitted)
- Committing
- Success (committed)
- Error (generation or commit failure)

---

## Possible Edge Cases
- No source PDF present
- PDF present but no raw words committed yet
- Generation returns empty word list
- Missing optional metadata fields
- Quad misalignment due to scaling issues
- Multi-page PDF rendering inconsistencies
- Multiple generations before commit
- Commit failure after successful generation
- Navigation attempt with uncommitted changes
- Corrupted or unreadable previously committed JSON

---

## Acceptance Criteria
- User can open config page for a document with a valid PDF
- User can generate raw words from the PDF
- Generated output follows required JSON structure :contentReference[oaicite:1]{index=1}
- Viewer correctly overlays quads on PDF
- UI clearly shows uncommitted vs committed state
- User can commit generated raw words to storage
- Reload reflects committed state correctly
- Navigation warning appears only when needed
- Deleting/replacing PDF purges raw words automatically
- No stale raw words can exist after PDF changes

---

## Open Questions
- Should we store generation metadata (timestamp, parser version)? timestamp is enough
- Should we expose raw JSON in UI (debug panel)? no we shouldn't, just the rendering
- Should quads support hover inspection for metadata? yes, I want to know the quad index for it
- Do we need a “Discard Changes” action, or is regenerate sufficient? I think regenerate is sufficient

---

## Testing Guidelines
Create test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases:

- loads committed raw words correctly
- generates raw words from valid PDF
- preserves JSON structure integrity
- renders quad overlays correctly
- marks state as dirty after generation
- commits and persists correctly to storage
- resets dirty state after commit
- shows error on generation failure
- shows error on commit failure
- warns on navigation with uncommitted changes
- allows navigation without warning when clean
- purges raw words when source PDF is deleted or replaced
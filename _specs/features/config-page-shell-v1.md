# Spec for config-page-shell-v1

branch: claude/feature/config-page-shell-v1  
figma_component (if used): n/a  

---

## Summary
Establish the foundational Config Page for PDF processing workflows. This serves as the control center for all future stages (raw words, canonicalization, nodes, chunks), but initially supports only PDF upload and commit.

The goal is to create the structural “stage board + viewer + control panel” layout so future steps can plug into it cleanly.

---

## Functional Requirements

### Entry & Navigation
- The Config Page is accessible from the homepage-admin implementation via a specific chatroom chip
- Selecting the relevant chatroom chip should navigate the user into that chatroom’s Config Page
- The Config Page should include:
  - a navbar route back to the homepage
  - a visible back button for returning to the homepage-admin view

### Unsaved Changes Protection
- If the user has staged changes that have not yet been committed, attempting to leave the page should trigger a warning
- This warning should apply to:
  - clicking the back button
  - using navbar navigation away from the page
  - browser-level navigation away from the page, where supported
- The warning should clearly indicate that there are uncommitted updates that may be lost
- The user should be able to:
  - stay on the page
  - leave without committing

### Layout Structure
- The page consists of **three main areas**:
  1. **Main Panel (Center/Left)**
     - PDF viewer (default empty state if no file uploaded)
     - No overlays or annotations for now

  2. **Right Panel A (Stage Panel)**
     - Displays pipeline stages as chips:
       - `PDF Upload` (only active chip for now)
       - Placeholder (disabled/greyed):
         - Raw Words Detection
         - Canonical Words Selection
         - Outline Generation
         - Chunk Assignment
         - Embeddings Generation

  3. **Right Panel B (Action Panel)**
     - Contains PDF upload interface
     - Contains commit controls

---

### PDF Upload (Action Panel)
- User can:
  - Upload a single PDF file

- After upload (before commit):
  - File is staged locally (not persisted yet)
  - Show:
    - File name
    - File size
    - Number of pages (if derivable pre-commit)

---

### Commit Behavior
- A **"Commit Updates"** button is present

- On click:
  - Upload PDF to configured Supabase storage
  - Persist metadata
  - Update UI state

---

### Cover Image Generation

- On "Commit Updates":
  - Extract the first page of the PDF
  - Convert it into a `.webp` image
  - Store it at:
    - assets/cover.webp

- The cover image should:
  - Maintain aspect ratio of the original page
  - Be optimized for fast loading (compressed)

---

### PDF Upload Chip (Stage Panel)
- Before commit:
  - Status: `Not committed` or `Pending`

- After commit:
  - Status: `Committed`
  - Display:
    - Last updated timestamp
    - File size
    - Page count

---

### PDF Viewer (Main Panel)
- Displays the uploaded PDF after commit
- No overlays, no interaction layers yet

- If no PDF:
  - Show empty state placeholder

---

### Data Persistence
- On commit:
  - Store file in **Supabase Storage**
  - The following paths are relative to the current document’s storage root.
    - PDF is stored at:
      - source/original.pdf
    - Assets (UI-friendly derivatives):
      - assets/cover.webp
    - Derived outputs are stored as single overwrite files:
      - derived/raw_words/latest.json
  - Store metadata:
    - file_name
    - file_size
    - page_count
    - last_updated_at

---

### State Reset Behavior
- Uploading a new file (before commit):
  - Replaces staged file

- Committing a new file:
  - Overwrites previous stored PDF + metadata

---

## Figma Design Reference (only if referenced)
- File: n/a  
- Component name: n/a  
- Key visual constraints:
  - Two right-side stacked panels
  - Clear separation between “Stages” and “Actions”
  - Viewer takes majority width

---

## Possible Edge Cases
- Uploading non-PDF file
- Uploading corrupted PDF
- Large file upload latency
- Failure during commit (partial upload)
- Page count extraction fails
- Re-upload before commit
- Commit clicked without file
- PDF first page fails to render
- Extremely large PDFs (slow image generation)
- Non-standard PDF encoding
- Cover generation timeout or failure

---

## Acceptance Criteria

- [ ] Config page renders with 3-panel layout (viewer + 2 right panels)
- [ ] Stage panel shows all stages with only PDF Upload active
- [ ] User can upload a single PDF
- [ ] Uploaded file is staged but not persisted before commit
- [ ] Clicking "Commit Updates":
  - uploads file to Supabase
  - stores metadata
- [ ] PDF Upload chip updates to:
  - show committed status
  - display last updated timestamp
  - display file size
  - display page count
- [ ] PDF viewer renders committed PDF
- [ ] Re-upload + commit replaces previous file cleanly
- [ ] No overlays appear in viewer
- [ ] On commit, cover image is generated from first page
- [ ] cover.webp is stored in assets directory
- [ ] Cover image loads correctly when retrieved
- [ ] Cover generation failure is handled gracefully (PDF still commits)

---

## Open Questions
- Should page count be extracted client-side or server-side? server side since the pdf is going to be put in storage
- Do we support versioning of PDFs or always overwrite? always overwrite for now
- Should commit require confirmation modal? yes
- What is max allowed PDF size? 20MB
- Should upload auto-trigger commit in future? not for now

---

## Testing Guidelines

Create test file(s) under `./tests`:

- Navigation:
  - page opens from homepage-admin chatroom chip
  - back button returns correctly
  - navbar navigation works correctly

- Unsaved changes:
  - warning appears when leaving with staged uncommitted changes
  - no warning appears when nothing has changed
  - leaving without committing discards staged changes correctly

- Upload flow:
  - valid PDF upload works
  - invalid file rejected

- Commit flow:
  - commit persists file + metadata
  - cover image is generated and stored
  - commit failure handled gracefully

- UI state:
  - chip reflects correct status pre/post commit
  - metadata displays correctly

- Replacement:
  - new commit overwrites old data correctly

- Viewer:
  - renders PDF after commit
  - empty state works when no PDF
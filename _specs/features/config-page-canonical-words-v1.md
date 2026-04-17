# Spec for config-page-canonical-words-v1

branch: claude/feature/config-page-canonical-words-v1
figma_component (if used): N/A

## Summary
- Add the Canonical Words stage on top of the implemented config-page-shell workflow.
- This stage starts from the existing Raw Words output and allows an operator to curate which raw-word quads are included in the canonical word set.
- In the PDF viewer, all raw-word quads should be lightly visible, while quads currently included in canonical words should be visually more distinct.
- By default, all raw words are included in canonical words on initial load, so the main operator action is usually to exclude unwanted words/quads.
- The action panel must support include and exclude actions, and the operator must be able to commit changes once the canonical selection is correct.
- Committing updates the `document_canonical_words` table.
- This stage must not mutate raw words data or the PDF. Canonical selection is a derived layer only.
- If any upstream dependency is regenerated, deleted, or reuploaded, the canonical words output for that document must be purged and the stage must be redone.

## Functional Requirements
- The Canonical Words stage must be accessible within the same config page shell pattern used for prior document-processing stages.
- This stage must depend on an existing Raw Words output for the active document.
- If Raw Words does not exist yet, the Canonical Words stage must not be actionable and should indicate that Raw Words must be generated first.
- On initial entry, the stage must treat all raw words as included in canonical words by default.
- The PDF viewer must render:
  - all raw-word quads in a very light treatment
  - canonical-included quads in a more visually distinct treatment
- The visual distinction must make it easy to understand:
  - what exists in raw words overall
  - what is currently part of the canonical set
- The action panel must allow the operator to:
  - exclude selected quads from canonical words
  - include previously excluded quads back into canonical words
- Include/exclude actions must only affect the current uncommitted working state until the operator commits.
- The stage must preserve the raw words source as immutable.
- The stage must not mutate the PDF or quad geometry.
- The stage must support iterative editing before commit, so operators can toggle selections multiple times.
- The stage must provide a commit action that writes the canonical selection into `document_canonical_words`.
- On commit, the canonical words output must be rebuilt from the currently included quads only.
- On commit, canonical rows must be re-ordered into a fresh contiguous canonical sequence.
- Excluding a quad must remove it from the committed canonical output on the next commit.
- Re-including a quad must place it back into the canonical output on the next commit.
- The canonical index must be recomputed from the included set only.
- Recomputing canonical index must not alter:
  - raw word indices
  - raw word records
  - source PDF data
- The mapping from canonical words back to raw words must still be preserved via the raw-word linkage in the canonical table.
- If the upstream PDF is reuploaded, replaced, or deleted, the canonical words output for that document must be purged.
- If the upstream Raw Words stage is regenerated, replaced, or deleted, the canonical words output for that document must also be purged.
- When canonical words are purged due to upstream invalidation, the stage must return to an ungenerated state and wait until the required upstream data exists again.
- If there are uncommitted changes and the operator tries to navigate away, the UI must warn before leaving, consistent with the broader config-page-shell navigation behavior.
- The commit state, dirty state, and last committed state should be clearly reflected in the action panel.

## Figma Design Reference (only if referenced)
- File: N/A
- Component name: N/A
- Key visual constraints:
  - Raw words should be visible but subdued
  - Canonical-included words should be clearly emphasized over raw-only words
  - The viewer/action-panel relationship should make inclusion state understandable at a glance
  - Uncommitted changes should be clearly distinguishable from committed state

## Possible Edge Cases
- Raw Words exists but is empty
- Operator excludes all quads, resulting in an empty canonical output
- Operator excludes words, then re-includes some before commit
- Operator makes edits but navigates away before committing
- Canonical words already exist and the operator reopens the stage to edit them
- Upstream Raw Words is regenerated while canonical words already exist
- PDF is reuploaded after canonical words were previously committed
- Canonical selection contains words across multiple pages and must still preserve correct ordering
- Duplicate text values exist in separate raw words, so inclusion/exclusion must be quad-based rather than text-based
- A quad is visually present in raw words but should not appear in canonical words after exclusion
- Upstream deletion happens after a user has an uncommitted working state open
- Commit is attempted when upstream raw words became stale or invalid mid-session

## Acceptance Criteria
- Operator can open the Canonical Words stage only for a document with an available Raw Words output
- On first load, every raw word is included in canonical words by default
- PDF viewer shows all raw-word quads lightly
- PDF viewer shows canonical-included quads more distinctly than raw-only quads
- Operator can exclude selected quads from the canonical set
- Operator can re-include excluded quads into the canonical set
- Include/exclude changes update the working state without mutating raw words or the PDF
- Committing writes the canonical output to `document_canonical_words`
- After commit, canonical rows reflect only included quads
- After commit, canonical indices are contiguous and re-derived from the included set
- Raw word indices remain unchanged regardless of canonical edits
- Reopening the stage after commit reflects the latest committed canonical state
- If PDF or Raw Words upstream data is regenerated, deleted, or replaced, existing canonical words for that document are purged
- After such purge, the stage no longer shows stale canonical output and must await valid upstream data again
- Navigation away with uncommitted changes prompts a warning
- No canonical action mutates prior-stage outputs

## Open Questions
- Should include/exclude operate only by direct quad selection in the viewer, or also through a list/table in the action panel? it should only be through quad selection
- Should there be a “reset to all included” action for quick recovery? yes
- Should commit fully replace all canonical rows for the document, or version them internally while exposing only the latest state? it should replace
- Should excluded quads remain visually visible after commit in a special excluded style, or only as raw-light quads? raw-light quads should be fine
- Should the stage support bulk actions by page or region? no need
- Should there be a visible count summary such as raw total / included total / excluded total? yes, in the action panel
- If upstream invalidation occurs while the page is open, should the stage hard reset immediately or only block further commit? hard reset for now

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Initial load where all raw words are automatically included in canonical words
- Viewer state where raw-word quads and canonical-included quads render with different visual treatments
- Excluding a quad removes it from the working canonical set
- Re-including a previously excluded quad adds it back into the working canonical set
- Commit writes only included rows into `document_canonical_words`
- Commit recomputes canonical indices contiguously from included rows only
- Raw words data remains unchanged after canonical edits and commit
- Existing canonical output reloads correctly when revisiting the stage
- Upstream Raw Words regeneration purges canonical words for the document
- Upstream PDF replacement/reupload purges canonical words for the document
- Navigation warning appears when leaving with uncommitted changes
- Empty canonical result behaves safely if all quads are excluded
- Duplicate text across different raw words is handled by quad/raw-word identity rather than text matching
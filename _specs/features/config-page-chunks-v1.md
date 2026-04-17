# Spec for chunks-editor

branch: claude/feature/chunks-editor
figma_component (if used): <figma-component-name>

## Summary
- Add a Chunks Editor stage to the document configuration workflow.
- Allow operators to create, view, assign, unassign, move, reorder, and delete chunks against the current outline structure.
- Chunks are created by selecting quads in the PDF viewer and committing them as a chunk.
- Chunks may be assigned to an outline node or remain unassigned.
- The Action Panel should make node assignment highly visible, especially for unassigned chunks that still need categorization.
- Viewer and panel behavior should clearly distinguish outline nodes from chunks.
- This stage must respect the storage and workflow conventions established in the config-page-shell and prior document-processing stages.
- If the outline stage is reset or regenerated, existing chunks should not be deleted. Instead, they should become unassigned and await reassignment against the new outline.

## Functional Requirements
- The Chunks Editor must be accessible as a stage within the existing config page workflow and must respect the navigation, commit model, and unsaved-changes protections established in the config-page-shell implementation.
- The stage depends on canonical words and outline nodes already existing for the document.
- The PDF viewer must display:
  - quad selections for potential chunk creation
  - subtle visual indication for outline nodes, preferably via outlining rather than filled highlight
  - chunk coverage via a light filled highlight that preserves legibility of the text
- The operator must be able to select quads in the viewer and create a chunk from that selection.
- Chunk creation must support two modes:
  - create chunk under the currently selected node
  - create chunk without selecting a node first, in which case the chunk is created as unassigned
- After a chunk is successfully added, the current quad selection in the viewer must be cleared.
- The Action Panel must display all available outline node buckets and a prominent unassigned bucket.
- The unassigned bucket must be visually prominent enough that operators can clearly identify chunks still awaiting assignment.
- Each node bucket in the Action Panel must clearly display:
  - node title
  - heading level / heading number (for example H1 / H2 / H3 as applicable)
  - whether the node is explicit or inferred
- Each chunk item in the Action Panel must display at minimum:
  - preview text using the first few words of the chunk
  - start and end canonical word indices
  - current assignment state
- The operator must be able to assign an existing chunk to a node from the Action Panel.
- The operator must be able to unassign a chunk from a node back into the unassigned bucket.
- The operator must be able to delete a chunk.
- The operator must be able to drag and drop chunks:
  - between one node bucket and another
  - between a node bucket and the unassigned bucket
  - within the same node bucket
- Drag-and-drop behavior must not allow chunk ordering that violates canonical text sequence within a node.
- Within the same node, chunks must always resolve to ascending order by `start_canonical_index`.
- If a user attempts to place a chunk in an order that conflicts with its canonical position, the system should auto-resolve the final position based on canonical order rather than preserving an invalid manual order.
- Chunk ordering at the document level must match the sequence implied by the current outline node order, with chunks grouped under their assigned node or under unassigned.
- The system must support chunks that are not assigned to any node by storing them with a null / empty node assignment state.
- The system must support moving chunks freely between assigned and unassigned states without mutating canonical words, raw words, or outline-node source content.
- Chunk data persisted to the document chunks table must reflect:
  - document identifier
  - chunk title / preview label as needed
  - chunk text
  - `start_canonical_index`
  - `end_canonical_index`
  - assigned node reference / assignment index
- Chunk indices / ordering metadata must reflect the sequence of the current outline node order.
- If the outline stage is reset, regenerated, or otherwise replaced:
  - existing chunk records must not be purged
  - all existing chunk-to-node assignments must be cleared
  - affected chunks must move into the unassigned bucket
  - the stage must remain editable so the operator can reassign chunks against the new outline
- If an upstream dependency required for chunk creation is changed or deleted:
  - if canonical words are regenerated or removed, chunks should be treated as invalid for editing until canonical words are re-established
  - if outline nodes are regenerated or removed, chunks should remain but become unassigned
- The stage must have an explicit commit action.
- Uncommitted chunk changes must remain local to the editor state until committed.
- Navigating away from the page or stage with uncommitted chunk edits must trigger the same unsaved-changes warning pattern used elsewhere in the config workflow.

## Figma Design Reference (only if referenced)
- File: N/A
- Component name: N/A
- Key visual constraints:
  - outline nodes in viewer should be indicated subtly, preferably as outlined quads
  - chunks in viewer should use a light fill that does not obscure text
  - unassigned bucket should be visually prominent
  - node buckets should clearly display node title, heading level, and explicit/inferred status
  - chunk rows should surface preview text and canonical index range clearly enough for quick triage

## Possible Edge Cases
- User creates a chunk without selecting a node first.
- User creates a chunk from non-contiguous or invalid quad selection.
- User creates a chunk whose canonical range overlaps an existing chunk.
- User drags a chunk to a position within a node that conflicts with canonical order.
- User drags a chunk between nodes with very different canonical ranges.
- User deletes a node assignment while the chunk still exists.
- Outline is regenerated after many chunks have already been assigned.
- Canonical words are regenerated, making previous chunk ranges stale or invalid.
- Multiple chunks under one node have adjacent or nearly identical canonical ranges.
- A chunk has no suitable node and remains unassigned for a long time.
- A node has zero chunks assigned.
- A document has chunks but no current outline because the outline step was reset.
- User navigates away with uncommitted chunk additions, deletions, reassignments, or drag-and-drop changes.

## Acceptance Criteria
- Operator can select quads in the viewer and create a chunk successfully.
- Operator can create a chunk with a selected node or without one.
- After chunk creation, the viewer selection is cleared automatically.
- Action Panel shows all node buckets plus a clearly visible unassigned bucket.
- Node buckets display title, heading level, and explicit/inferred state.
- Chunk rows display preview text and canonical index range.
- Operator can assign, unassign, move, and delete chunks.
- Operator can drag chunks between nodes and unassigned.
- Chunks inside the same node always resolve in ascending `start_canonical_index` order.
- Viewer visually distinguishes nodes from chunks in the intended subtle vs filled manner.
- Chunk persistence writes the expected fields to the chunks table.
- Resetting or regenerating outline does not delete chunks and instead unassigns them.
- Unsaved edits trigger a warning before navigating away.
- Committing changes persists the latest chunk state and reloads correctly.

## Open Questions
- Should chunk creation be blocked entirely for overlapping ranges, or should overlapping chunks be allowed temporarily and surfaced as warnings? overlapping between other chunks and headers should not be allowed
- Should chunk titles be system-generated from preview text only, or user-editable? system generated from just the first few words of the chunk
- Should there be validation enforcing sequentially adjacent quads for chunk creation, similar to explicit node creation? no need for this one
- Should the Action Panel allow multi-select chunk reassignment in bulk, or is single-chunk interaction enough for V1? single chunk interaction is enough
- When canonical words are regenerated, should stale chunks be fully invalidated, soft-disabled, or preserved for manual repair? ah yes, if pdf or canonical words are edited, then stale chunks should be invalidated, and will need to be redone. but if it's just headers, then it's what we discussed. the chunks are left in an unassigned bucket
- What exact field should represent assignment in storage: node id, node index, or both? Chunk assignment in storage should use `assigned_node_id` only, not `node_index`.`node_index` should be treated as derived UI/order state based on the current outline structure, not persisted as the source of truth for assignment. Chunk ordering within a node should be derived from `start_canonical_index`.If outline nodes are reset or regenerated and prior node identities are no longer valid, existing chunks should be preserved and their `assigned_node_id` should be cleared, making them unassigned until reassigned against the new outline.
- Should the unassigned bucket be sorted purely by canonical index, by recency of edit, or both with toggleable sort? canonical index for the starting quad

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- create a chunk from a valid quad selection under a selected node
- create a chunk from a valid quad selection with no node selected, resulting in an unassigned chunk
- verify quad selection is cleared after successful chunk creation
- assign an unassigned chunk to a node
- unassign a chunk from a node back to the unassigned bucket
- delete a chunk successfully
- drag a chunk from one node to another
- drag a chunk from a node to unassigned and from unassigned to a node
- verify chunks within the same node resolve to ascending `start_canonical_index`
- verify invalid manual ordering within a node is auto-corrected to canonical order
- verify node metadata renders correctly in the Action Panel
- verify chunk preview text and canonical indices render correctly
- verify outline reset/regeneration preserves chunks but clears assignments
- verify unsaved-changes warning appears on navigation when edits are pending
- verify committed chunk state reloads correctly from persisted data
# Spec for config-page-nodes-v1

branch: claude/feature/config-page-nodes-v1
figma_component (if used): none

## Summary
- Add an Outline step to the document configuration workflow that lets an operator create, edit, organize, and commit outline nodes for a document.
- Support two node types:
  - Explicit nodes: created from selected canonical-word quads that exist in the PDF
  - Inferred nodes: created manually even when no corresponding quads exist in the PDF
- Let the operator assign heading levels (`h1`, `h2`, `h3`) to all nodes.
- Keep node ordering aligned with the action panel, while preserving quad-order integrity for explicit nodes.
- Persist committed outline nodes into the `document_nodes` table, whose shape includes `document_id`, `node_index`, `parent_node`, `node_type`, `label`, `start_canonical_index`, and `end_canonical_index` as shown in the attached schema. :contentReference[oaicite:0]{index=0}

## Functional Requirements
- This feature must be implemented as the next stage after canonical words and must respect the existing config-page-shell workflow and navigation patterns established in the prior specs.
- The Outline step must only be available once the prerequisite prior stage has been successfully committed.
- If the previous stage is regenerated, reuploaded, deleted, or otherwise invalidated, this Outline stage must be purged/reset as well and must require the operator to complete the prerequisite stage again before outlines can be edited or committed.

### 1. Outline workspace and source of truth
- The Outline step must use the committed canonical words as its source of truth for explicit-node creation.
- The PDF viewer must continue rendering the document and quads.
- The action panel must serve as the primary control surface for outline-node creation, editing, review, ordering, and commit.
- Until committed, outline edits should be treated as draft state within the current session/page state.
- If the operator attempts to leave the page or navigate away with uncommitted outline changes, they must receive the same style of unsaved-changes warning used elsewhere in the config workflow.

### 2. Create explicit nodes from quad selection
- The operator must be able to select quads in the PDF viewer and create a new outline node from that selection via an action-panel action such as “Add as node”.
- An explicit node must only be creatable from quads that map to canonical words currently included in the document.
- When creating an explicit node, the system must derive:
  - node label from the selected canonical words
  - `start_canonical_index` from the first selected canonical word
  - `end_canonical_index` from the last selected canonical word
- Explicit node creation must validate that the selected quads are sequentially adjacent in reading order.
- If the selected quads are not sequentially adjacent, the create action must be blocked with a clear validation message.
- Explicit nodes must not allow disjoint selections that would create ambiguous or broken header spans.
- Explicit node creation should avoid duplicate overlapping explicit nodes unless explicitly supported later; for this version, overlapping explicit headers should be blocked.

### 3. Create inferred nodes
- The operator must be able to create an inferred node from the action panel without selecting quads in the viewer.
- When creating an inferred node, the operator must be able to enter a label/name manually.
- Inferred nodes represent structural headings that do not directly correspond to visible quads in the PDF.
- Inferred nodes must still require a heading level assignment (`h1`, `h2`, or `h3`) before commit.
- Inferred nodes should not require `start_canonical_index` / `end_canonical_index` to correspond to a visible header selection; their persisted representation should follow the agreed table behavior for inferred nodes.

### 4. Heading-level assignment
- Every node must have a heading level of `h1`, `h2`, or `h3`.
- The operator must be able to assign and edit heading level from the action panel.
- Both explicit and inferred nodes must support heading reassignment before commit.
- Heading level must be visually visible in the panel for every node.
- A node cannot be committed without a valid heading level.

### 5. Node list / action panel behavior
- The action panel must show all current outline nodes in a single ordered list.
- For each node, the panel must show at minimum:
  - label
  - heading level (`h1`, `h2`, `h3`)
  - whether the node is explicit or inferred
- The panel should make it easy to inspect the current structure of the document at a glance.
- Selecting a node in the panel should highlight or otherwise focus its corresponding header quads in the viewer when applicable.
- For inferred nodes, selection in the panel should still visually indicate the selected row/node even though no quad highlight exists in the viewer.

### 6. Ordering and drag/drop rules
- The ordering shown in the action panel is the authoritative order for committed `node_index`.
- Inferred nodes must be draggable and droppable within the action panel so the operator can place them where needed.
- Explicit nodes must not be movable in a way that violates their relative quad sequence in the document.
- Explicit nodes should remain anchored to their PDF/canonical-word order relative to other explicit nodes.
- The UI may allow inferred nodes to be inserted between explicit nodes, above them, or below them, so long as the resulting panel order is valid.
- If a drag/drop action would place an explicit node out of sequence relative to another explicit node, the move must be blocked.
- If needed, the UI may simply disable dragging for explicit nodes altogether, while still allowing inferred nodes to move around them.

### 7. Visual linkage between viewer and outline nodes
- Header quads corresponding to explicit nodes must be visually distinct in the PDF viewer from normal canonical-word quads.
- The visual treatment of header quads should correspond to the node presentation in the action panel, ideally via consistent color-coding or another clear pairing mechanism.
- Different nodes should be distinguishable from one another in both the panel and the viewer.
- The visual treatment must remain legible even when multiple headers appear on the same page.
- Inferred nodes should have a visually distinct treatment in the panel to make clear that they do not map to visible quads.
- The UI should avoid confusion between:
  - lightly rendered canonical/raw quads
  - explicit header-highlighted quads
  - currently selected quads for potential node creation

### 8. Editing and deletion
- The operator must be able to delete nodes before commit.
- Deleting an explicit node must remove only the outline node record/draft representation, not mutate canonical words, raw words, or the PDF itself.
- Deleting an inferred node must remove only that inferred node from draft state.
- The operator must be able to rename inferred nodes before commit.
- If explicit-node labels are editable in the UI, editing the label must not mutate the underlying canonical words; it should only affect the node label that is stored for the outline.

### 9. Parent/child structure
- The outline must support hierarchical structure based on heading levels.
- The persisted `parent_node` relationship in `document_nodes` should be derived from the ordered node list and assigned heading levels.
- Parent assignment should follow natural outline rules:
  - an `h2` belongs to the nearest preceding valid `h1`
  - an `h3` belongs to the nearest preceding valid `h2`
- If a node’s heading level creates an invalid hierarchy, commit must either:
  - block with validation, or
  - apply a clearly defined fallback rule agreed by product/engineering
- The preferred behavior is to validate and block obviously invalid structures rather than silently infer surprising parents.

### 10. Commit behavior and persistence
- The operator must be able to commit outline changes explicitly.
- On commit, the system must write the full committed outline state into `document_nodes`.
- `node_index` must be reassigned based on the final order shown in the action panel at the moment of commit.
- The persisted ordering must match the operator-visible order exactly.
- Persisted records must distinguish explicit vs inferred nodes through the agreed `node_type` representation.
- Explicit nodes must persist the canonical index span derived from their selected header words.
- Inferred nodes must persist using the agreed inferred-node representation in the table.
- Commit should replace the prior outline state for that document rather than append duplicate historical node rows for the same active version.

### 11. Regeneration / purge behavior
- If the prerequisite prior stage changes in a way that invalidates canonical-word indexing or quad alignment, all outline data for the document must be deleted/purged.
- This purge must include both committed and draft outline state tied to the invalidated prior-stage output.
- After purge, the Outline step must return to an empty/unconfigured state until the prerequisite stage is completed again.
- The product should make this reset behavior clear so the operator understands why outlines disappeared after upstream changes.

### 12. Navigation and stage integrity
- The Outline step must be reachable through the document config workflow established from the homepage/chatroom path.
- The operator must be able to navigate out via the navbar/back controls.
- If there are uncommitted outline changes, navigation away must prompt the user with a warning and prevent accidental loss unless explicitly confirmed.

## Figma Design Reference (only if referenced)
- File: none yet
- Component name: none yet
- Key visual constraints:
  - Action panel and viewer should feel consistent with the existing config-page-shell implementation
  - Outline nodes should be easy to scan
  - Explicit vs inferred should be visually obvious
  - Header highlights in the PDF viewer should correspond clearly to node rows in the panel

## Possible Edge Cases
- User selects non-adjacent quads and tries to create an explicit node.
- User selects quads that overlap an existing explicit node.
- User creates inferred nodes but forgets to assign heading level.
- User assigns `h3` where there is no valid preceding `h2`.
- User drags an inferred node into a position that creates an invalid hierarchy.
- User tries to move an explicit node out of quad order.
- User regenerates or edits the previous stage after outlines already exist.
- User leaves the page with uncommitted outline edits.
- Multiple explicit headers occur very close together on the same page, making highlight colors hard to distinguish.
- Explicit header text is visually split across lines but still sequential in reading order.
- A document has no good explicit headers, so the structure is mostly inferred nodes.

## Acceptance Criteria
- Operator can create an explicit node by selecting sequentially adjacent quads and triggering “Add as node”.
- Explicit-node creation is blocked when the selected quads are not sequentially adjacent.
- Operator can create an inferred node without selecting quads and provide a custom label.
- Every node can be assigned `h1`, `h2`, or `h3`.
- Action panel shows all nodes with label, heading level, and explicit/inferred status.
- Explicit-node header quads are visually distinct in the PDF viewer and correspond clearly to their panel representation.
- Inferred nodes can be drag-dropped within the action panel.
- Explicit nodes cannot be reordered in ways that violate their PDF/canonical sequence.
- Final committed `node_index` matches the node order shown in the action panel.
- Commit writes outline rows into `document_nodes` with the expected shape and hierarchy.
- Deleting or regenerating the prior stage purges this stage’s data and requires redoing outlines.
- Unsaved outline changes trigger a navigation warning before the operator exits the page.

## Open Questions
- Should explicit-node labels be editable, or should they always mirror the selected header text exactly? they should alway mirror the selected header text
- For inferred nodes, what exact persisted values should be used for `start_canonical_index` and `end_canonical_index`? I guess null
- Should invalid hierarchy be blocked entirely at edit time, only at commit time, or auto-repaired? blocked at edit time.
- Do we want per-level fixed colors (`h1/h2/h3`) or per-node unique colors? maybe per level fixed colors here
- Should overlapping explicit nodes be fully disallowed, or are there valid cases to support later? overlapping should be disallowed
- Should there be a mini tree/indent visualization in the panel based on heading level? yes there should be
- Should the panel support bulk actions, such as deleting multiple nodes or reassigning heading levels in bulk? not need for now

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Create an explicit node from a valid sequential quad selection.
- Block explicit-node creation from a non-sequential quad selection.
- Create an inferred node with a custom label.
- Assign and update heading levels for explicit and inferred nodes.
- Derive parent-child relationships correctly from ordered `h1/h2/h3` nodes.
- Allow inferred-node drag/drop and preserve resulting order on commit.
- Prevent explicit-node reordering that would violate quad order.
- Persist committed node order into `node_index` exactly as shown in the panel.
- Purge outline data when the previous stage is regenerated or invalidated.
- Warn on navigation when outline changes exist but are not committed.
# Spec for config-page-rename

branch: claude/feature/config-page-rename
figma_component (if used): n/a  

---

## Summary
Add a chatroom title display to the Config Page pipeline panel area so the user can clearly see which chatroom they are configuring.

The chatroom name should be placed above the existing pipeline content in an appropriate, visually clear position. The title should support inline editing via hover and direct text editing, with save-on-blur and save-on-enter behavior.

This rename flow should reuse the same validation standards as chatroom creation, including duplicate-name prevention.

---

## Functional Requirements

### Placement & Visibility
- The Config Page should display the current chatroom name above the pipeline section where `PDF Upload` and future stages are shown
- The placement should follow best practice for hierarchy and clarity:
  - the chatroom name should visually read as the contextual title for the pipeline/configuration area
  - it should not compete with global navigation
  - it should clearly indicate which chatroom the current config page belongs to
- The title should be visible in both read-only and editable states

### Default Read-Only State
- By default, the chatroom name is displayed as static text
- On hover, the title area should indicate editability
- The hover affordance should be subtle but clear:
  - an edit-style outline, border, or hover container appears around the title area
  - the interaction should suggest that the name can be clicked and edited inline

### Entering Edit Mode
- Clicking the chatroom name area puts it into inline edit mode
- In edit mode:
  - the current chatroom name becomes an editable text input
  - the current value is prefilled
  - the input should receive focus automatically
  - the text should be easy to replace or modify without requiring extra clicks

### Saving Behavior
- When the user edits the name, the rename should save when either of the following occurs:
  - the user presses `Enter`
  - the user clicks outside the input (blur)
- A successful save should:
  - persist the new chatroom name
  - update the visible title immediately
  - exit edit mode

### Validation Rules
- The rename flow should use the same validation logic as chatroom creation
- This includes any existing rules already enforced during create chatroom, including:
  - duplicate-name prevention
  - trimming / empty-name handling
  - any casing or normalization rules already used by create chatroom
  - any min/max length or invalid character rules already used by create chatroom
- Rename should not allow a duplicate if another chatroom already uses that valid-equivalent name under the same validation rules
- Validation should be consistent with create chatroom so the user is not exposed to two different naming standards in the product

### Validation Failure Behavior
- If validation fails, the rename should not persist
- The user should remain in edit mode or otherwise receive immediate correction feedback
- The error state should clearly communicate why the rename was rejected
- If the reason is duplication, the UI should explicitly indicate that the name already exists
- The prior committed name should remain unchanged unless validation passes

### No-Op Behavior
- If the user enters edit mode but does not change the name, no update should be persisted
- If the user changes only whitespace that normalizes back to the same valid name, no duplicate or unnecessary update should be triggered
- If the user clears the field and clicks away, behavior should follow the same validation rules as create chatroom rather than allowing an empty committed name

### Interaction Expectations
- The inline rename interaction should feel lightweight and fast
- It should not require a modal
- It should not require a separate dedicated settings page
- It should work naturally within the existing Config Page shell implementation
- It should not disrupt the rest of the pipeline panel layout

### Persistence
- On successful rename:
  - the underlying chatroom record in Postgres should be updated
  - the new name should be reflected on subsequent reloads
- Renaming a chatroom should not alter:
  - chatroom identity
  - related document associations
  - storage paths
  - pipeline stage state
  - any existing config data linked to that chatroom

---

## Figma Design Reference (only if referenced)
- File: n/a  
- Component name: n/a  
- Key visual constraints:
  - Chatroom name should sit above the pipeline content as the local contextual header
  - Hover affordance should be subtle, not noisy
  - Inline edit state should feel native to the panel rather than like a separate form
  - Error handling should be visible without breaking panel layout

---

## Possible Edge Cases
- User attempts to rename to an existing chatroom name
- User enters only whitespace
- User adds leading/trailing whitespace
- User presses Enter with invalid input
- User clicks outside with invalid input
- User clicks into edit mode and then makes no changes
- User rapidly clicks in and out of the field
- Chatroom name is very long
- Rename request fails due to backend/network error
- Two users attempt to rename conflicting chatrooms concurrently
- Validation logic on frontend and backend becomes inconsistent
- Normalized duplicate exists even if raw text looks slightly different

---

## Acceptance Criteria

- [ ] Config Page displays the current chatroom name above the pipeline section
- [ ] Chatroom title has a hover affordance that indicates inline editability
- [ ] Clicking the title enters inline edit mode
- [ ] Input is prefilled with the current chatroom name
- [ ] Input auto-focuses on entering edit mode
- [ ] Pressing `Enter` attempts to save the new name
- [ ] Clicking outside the input attempts to save the new name
- [ ] Successful rename persists to Postgres
- [ ] Successful rename updates the visible title immediately
- [ ] Rename uses the same validation rules as create chatroom
- [ ] Duplicate names are rejected
- [ ] Invalid names are rejected
- [ ] On validation failure, the old committed name remains unchanged
- [ ] Validation feedback is clearly shown to the user
- [ ] If no actual valid change was made, no unnecessary update is persisted
- [ ] Renaming does not affect linked documents, config state, or storage structure

---

## Open Questions
- Should `Escape` cancel editing and revert to the last committed name? yes
- Should the UI show an explicit edit icon, or should the hover outline alone be the affordance? hover outline is enough. when it's clicked in, there should be a slight pixel shift, the hover outline should colorize or bolden, and a type cursor should appear
- Should very long chatroom names wrap to multiple lines, truncate, or scroll horizontally in edit mode? there should be a limit to the length of the name, I think 50 characters
- Should rename errors be shown inline below the field or inside the input container? inline below would be better I think
- Should duplicate validation be checked optimistically on the client, authoritatively on the server, or both? ideally both

---

## Testing Guidelines

Create test file(s) under `./tests`:

- Rendering:
  - current chatroom name appears above the pipeline section
  - hover affordance appears correctly

- Edit interaction:
  - clicking title enters edit mode
  - input is prefilled with the existing name
  - input auto-focuses

- Save behavior:
  - pressing Enter saves valid rename
  - clicking outside saves valid rename
  - successful save exits edit mode and updates UI

- Validation:
  - duplicate name is rejected
  - empty / whitespace-only name is rejected
  - normalized same-name no-op does not trigger unnecessary update
  - invalid names are handled consistently with create chatroom rules

- Persistence:
  - valid rename updates Postgres correctly
  - renamed value persists after reload

- Safety:
  - failed rename does not mutate committed chatroom name
  - rename does not affect document associations or pipeline state
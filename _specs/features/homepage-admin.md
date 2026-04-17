# Spec for homepage-admin

branch: claude/feature/homepage-admin
figma_component (if used): none

## Summary
- Build the admin homepage for the internal Stage 1 MVP.
- The page should include a navbar and a main content area.
- The navbar should display the brand "RuleResolve" on the top left and a logout button on the top right.
- The main page should include a hero section that introduces the product and a subtitle describing its purpose.
- Below the hero section, a list of chatrooms (games) should be displayed as medium-sized cards.
- Chatrooms and their display metadata should be sourced from PostgreSQL
- Associated assets such as cover images may be stored in Supabase storage and referenced via stored paths or URLs
- The chatroom cards are for display only in this stage and should not allow entry into the chat experience.
- The layout should be simple and structured in a way that can be adapted for mobile in the future.

## Functional Requirements
- Display a navbar with:
  - "RuleResolve" brand text on the top left
  - a logout button on the top right
  - a persistent "Admin" indicator or badge next to the brand
- The "Admin" indicator must:
  - always be visible on the navbar
  - clearly communicate that the current view is for admin users
  - persist across all admin pages in Stage 1
- Clicking the logout button should:
  - clear the user session
  - redirect the user back to the login page
- Display a hero section containing:
  - a prominent title (e.g. "RuleResolve")
  - a subtitle describing the purpose of the app
- Below the hero section, display a list of chatrooms:
  - chatrooms should be fetched from the PostgreSQL database
  - each chatroom represents a board game
  - chatrooms should be displayed as medium-sized cards
- The list of chatrooms should:
  - appear partially on initial load to encourage scrolling
  - be visually distinct from the hero section
- Each chatroom card should:
  - display at minimum the chatroom name
  - optionally display lightweight metadata if available (e.g. number of documents)
  - Each chatroom card may display a cover image if one is available
  - If no cover image is available, the card should still render cleanly with a fallback visual state
- Chatroom cards should be non-interactive for entering the chat experience:
  - either disabled or clearly marked as "under construction"
- The page should assume:
  - chatrooms and related document records already exist in PostgreSQL
  - optional visual assets such as cover images may exist in Supabase storage
- The homepage must not depend on deriving storage paths from chatroom names
- Any cover image or storage-backed asset shown on a chatroom card should come from metadata/path references already associated with the chatroom or document record
- The layout should:
  - be clean and simple
  - allow for future responsiveness to mobile screens
  - not require full mobile optimization in Stage 1

## Figma Design Reference (only if referenced)
- File: none
- Component name: none
- Key visual constraints:
  - Navbar should be fixed or clearly separated from content
  - Hero section should feel prominent but not oversized
  - Chatroom cards should be visually scannable and evenly spaced
  - Clear separation between hero and chatroom list
  - Visual style should be minimal and internal-tool oriented
  - The Admin indicator should be visually distinct but not overwhelming, easily scannable at a glance, consistent across all admin pages

## Possible Edge Cases
- No chatrooms exist in the database
- Chatrooms exist but have no associated documents
- Database fetch for chatrooms fails
- User clicks logout during page load
- User tries to interact with disabled chatroom cards
- Very large number of chatrooms causing overflow or layout issues
- Chatroom names are unusually long
- Network latency causes delayed rendering of chatrooms
- Chatroom has no cover image in storage
- Chatroom has broken or missing storage path metadata
- Chatroom exists with documents, but no display asset is available

## Acceptance Criteria
- The admin homepage displays a navbar with "RuleResolve" on the left and a logout button on the right
- Clicking logout successfully logs the user out and redirects to the login page
- The hero section is visible and contains a title and descriptive subtitle
- A list of chatrooms is displayed below the hero section
- Chatrooms are fetched from PostgreSQL and rendered as medium-sized cards
- The initial viewport shows the hero section and part of the chatroom list (encouraging scroll)
- Chatroom cards are not usable for entering a chat experience and are clearly marked or disabled
- The page renders correctly with existing chatrooms and documents
- The layout is clean and structured to support future responsiveness
- Chatroom cards render correctly whether or not a cover image exists
- Homepage data is driven from PostgreSQL records and does not rely on hardcoded or name-derived storage paths
- The navbar includes a persistent "Admin" indicator next to the RuleResolve brand
- The Admin indicator is visible on the homepage and is designed to persist across all admin views

## Open Questions
- What exact subtitle copy should be used in the hero section? 'Don't know the exact rules to your favorite board game? Just ask the rulebook directly'
- Should chatroom cards show additional metadata (e.g. number of documents, last updated time)? should just be the boardgame name, the cover image, that's it.
- Should there be a placeholder or empty state if no chatrooms exist? yeah, maybe something like 'Board games in progress...'
- Should chatrooms be ordered in a specific way (e.g. most recent first)? maybe just alphabetical now
- Should there be a loading skeleton while chatrooms are being fetched? not for now. 
- Should the navbar be fixed or scroll with the page? either is fine, just make sure it's easy to change later

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Render test for navbar, hero section, and chatroom list
- Logout interaction test confirming session is cleared and redirect occurs
- Chatroom fetch test confirming data from PostgreSQL is displayed correctly
- Empty state test when no chatrooms exist
- Disabled state test confirming chatroom cards cannot be interacted with
- Layout test confirming partial chatroom visibility on initial load (scroll encouragement)
- Error handling test when chatroom fetch fails
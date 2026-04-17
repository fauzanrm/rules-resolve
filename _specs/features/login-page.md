# Spec for login-page

branch: claude/feature/login-page
figma_component (if used): none

## Summary
- Build a barebones login page for the internal Stage 1 MVP.
- The page should authenticate against the existing PostgreSQL usernames and plaintext passwords table.
- Before signing in, the user must check a Terms and Conditions checkbox.
- The words "Terms and Conditions" should be clickable and open a popup/modal so the user can read the document.
- If credentials are incorrect, the page should inform the user in an elegant, simple, non-jarring way.
- Users can try signing in as many times as needed.
- If login is successful, the UI should clearly indicate success before routing the user onward.
- The page should display the following text at the top:
  - "RuleResolve Beta"
  - "Thank you for participating in our beta. Sign in with your credentials and you can start asking questions about the rules of your favorite board games"

## Functional Requirements
- Display a login page with:
  - a title section
  - username input
  - password input
  - Terms and Conditions checkbox
  - sign-in button
- The title section must show:
  - "RuleResolve Beta"
  - "Thank you for participating in our beta. Sign in with your credentials and you can start asking questions about the rules of your favorite board games"
- The user must not be allowed to submit the form unless the Terms and Conditions checkbox is checked.
- The text "Terms and Conditions" must be clickable and open a popup/modal containing the Terms and Conditions content.
- On submit, the system must validate the entered username and password against the existing PostgreSQL users table.
- Plaintext password matching is acceptable for this internal MVP.
- If the credentials are valid:
  - the UI should indicate successful login
  - the user should then be routed based on role
- If the credentials are invalid:
  - the page should display an elegant error state
  - the page should not clear the form unnecessarily
  - the user should be allowed to try again immediately
- There should be no artificial lockout, cooldown, or attempt limit in this MVP.
- The page should support both `admin` and `user` roles.
- After successful login:
  - `admin` users should be routed to the admin homepage
  - `user` users should be routed to the under-construction page
- The page should be visually simple and functional, optimized for internal beta use rather than heavy polish.

## Figma Design Reference (only if referenced)
- File: none
- Component name: none
- Key visual constraints:
  - Keep the page minimal and clear
  - The hierarchy should make the RuleResolve Beta title and supporting text prominent
  - Error and success states should feel calm and polished, not harsh or overly loud
  - Terms and Conditions popup/modal should be readable and easy to dismiss

## Possible Edge Cases
- User attempts to sign in without checking the Terms and Conditions checkbox
- User enters an invalid username
- User enters a valid username with an invalid password
- User enters empty username or password fields
- User closes the Terms and Conditions popup without checking the checkbox
- User checks the checkbox without opening the Terms and Conditions popup
- User submits valid credentials for an `admin` account
- User submits valid credentials for a `user` account
- Database connection fails or auth validation cannot be completed
- User clicks sign in multiple times quickly while a request is in progress

## Acceptance Criteria
- A login page exists and displays the required RuleResolve Beta title and subtitle copy
- The page includes username and password fields, a Terms and Conditions checkbox, and a sign-in button
- The words "Terms and Conditions" are clickable and open a popup/modal with the Terms and Conditions content
- The form cannot be submitted unless the Terms and Conditions checkbox is checked
- Valid credentials from the existing PostgreSQL users table allow login
- Invalid credentials show a clear and elegant error message
- Users can retry login without restriction
- Successful login shows a visible success state before navigation
- `admin` users are routed to the admin homepage after successful login
- `user` users are routed to the under-construction page after successful login
- The page works as a simple internal MVP without requiring production-grade auth hardening

## Open Questions
- Should the success state be a short inline message, a toast, or a transient loading/success screen before redirect? toast should be okay
- Should the Terms and Conditions content live directly in the frontend, come from a static file, or be fetched from the backend? static file
- Should the login page preserve the entered username after an invalid password attempt? yes it should
- Should there be a loading state on the sign-in button while authentication is in progress? no need for now
- Should users who are already authenticated be redirected away from the login page automatically? yes

## Testing Guidelines
Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:
- Render test for the login page title, subtitle, inputs, checkbox, and sign-in button
- Validation test showing that submission is blocked when Terms and Conditions is unchecked
- Interaction test confirming that clicking "Terms and Conditions" opens the popup/modal
- Successful login test for a valid `admin` account
- Successful login test for a valid `user` account
- Invalid credentials test showing the elegant error state
- Retry test confirming the user can attempt login again after failure
- Empty field validation test for username and password
- Loading/submission state test to ensure duplicate rapid submissions are handled reasonably
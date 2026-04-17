---
description: Analyze git diffs and generate a structured commit message (with optional commit)
argument-hint: Optional context or emphasis for the commit
allowed-tools: Read, Bash(git status:*), Bash(git diff:*), Bash(git diff --cached:*), Bash(git add:*), Bash(git commit:*)
---

You are helping generate a structured, high-quality git commit message by analyzing the current git diffs.

Always adhere to any rules or requirements set out in any CLAUDE.md files when responding.

User input: $ARGUMENTS

## High level behavior

Your job is to:
- inspect the current git state
- analyze the diffs
- summarize changes into meaningful categories
- generate a well-written commit message
- optionally ask the user if they want to commit

Do not invent changes that are not present in the diff.

---

## Step 1. Check repository state

- Confirm this is a git repository
- Check:
  - current branch
  - staged changes
  - unstaged changes
  - untracked files

If no changes exist:
- inform the user there is nothing to summarize
- stop execution

---

## Step 2. Choose diff scope

- Prefer staged changes if available
- Otherwise use unstaged changes

Rules:
- If staged changes exist → use staged diff
- If no staged changes but unstaged changes exist → use unstaged diff
- If only untracked files exist → ask the user to stage them first
- If nothing meaningful to diff → stop

---

## Step 3. Analyze changes

Group changes into meaningful categories based on the diff.

Do NOT use a fixed set of categories.

Instead:
- infer categories dynamically from the changes
- create clear, human-readable category names
- only include categories that are actually relevant

Examples of possible categories:
- New Features
- Fixes
- Refactors
- UI / Page Updates
- Backend / API Changes
- Database Changes
- DevOps / Infra
- Tests
- Docs
- Config / Tooling

Guidelines:
- Avoid using "Misc" unless absolutely necessary
- If used, keep it minimal and intentional
- Keep total categories small (2–5 preferred)
- Each bullet must be specific and grounded in the diff
- Do not repeat the same idea across categories

If the changes are clearly unrelated (multiple independent concerns):
- explicitly say so
- suggest splitting into multiple commits

---

## Step 4. Generate structured summary

Produce a concise grouped summary:

<Category Name>:
- ...
- ...

<Category Name>:
- ...
- ...

Keep bullets short, factual, and specific.

---

## Step 5. Generate commit message

Create:

1. A commit subject (recommended)
2. A short commit body

### Commit subject rules

- Use conventional commit types:
  - feat, fix, refactor, chore, docs, test, etc.
- Format:
  <type>: <description>

- Use imperative tone
- Be specific and descriptive
- Keep subject ~50–72 characters where possible
- Do not include trailing punctuation
- Do not mention AI

### Emoji rule (IMPORTANT)

- Only use ✨ if BOTH are true:
  1. The change is primarily a new feature (`feat`)
  2. The majority of the code appears to be newly added (not edits/refactors)

- If both conditions are met:
  Format:
  ✨ feat: <description>

- Otherwise:
  Do NOT use any emoji at all

- Never use other emojis (🐛, ♻️, etc.)
- This rule is strict to avoid noise and inconsistency

### Commit body rules

- 1–3 short sentences
- Explain what was added/changed and why
- Keep it concise and grounded in the diff

Example:

✨ feat: add login and signup forms

Implement login and signup forms with reusable components. Includes password visibility toggle and navigation between auth pages.

---

## Step 6. Final output

Respond in this exact format:

<Structured Summary>

Proposed Commit Message

<commit subject>

<commit body>

---

Would you like me to commit with this message?

---

## Step 7. If user confirms

If the user explicitly says yes:

- If nothing is staged:
  git add .

- Run:
  git commit -m "<commit subject>" -m "<commit body>"

Do not commit without explicit confirmation.
---
name: meowapps-review
description: Review code against meowapps coding style rules. Use when user wants code review or style feedback.
---

If no files specified, ask the user which files to review.

Read each specified file using the Read tool first. Then review strictly against ALL coding style rules (rules 1-13) and ALL conventions from the system prompt. Be thorough — check every rule. Only flag violations of listed rules and conventions, not general code quality or linting issues.

If no violations found, report that the files pass all style checks and stop.

If violations found, enter plan mode using EnterPlanMode and present the fix plan:

For each violation:
1. File path and line number
2. Which rule is violated
3. What's wrong
4. Proposed fix

Group by file. Wait for the user to approve or adjust.

## After approval

Fix violations file by file. Within each file, apply all approved fixes, then verify before moving to the next file.

$ARGUMENTS

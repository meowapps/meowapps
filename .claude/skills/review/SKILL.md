---
name: review
description: Review code against meowapps coding style rules. Use when user wants code review or style feedback.
---

Review the specified file(s) against the coding style rules and conventions in your system prompt. Report violations only — do not fix.

## Output format

For each violation found:
1. File path and line number
2. Which rule is violated
3. What's wrong
4. What it should look like

If no violations found, say so.

$ARGUMENTS

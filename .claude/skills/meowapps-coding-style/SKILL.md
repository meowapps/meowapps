---
name: meowapps-coding-style
description: Review or refactor code against meowapps coding style rules (rules 1-13 + conventions). Use when user wants code review, style feedback, or style-compliant refactoring.
---

Read `reference.md` from the same directory as this SKILL.md file. It contains all coding style rules with examples.

If no files specified, ask the user which files to review or refactor.

## Mode: review (default)

Read each file. Check every rule (1-13) and every convention from reference.md. Only flag violations of listed rules and conventions — not general code quality or linting.

If no violations: report that files pass all style checks and stop.

If violations found, present findings grouped by file:

For each violation:
1. File path and line number
2. Which rule is violated (by number and name)
3. What's wrong (one line)
4. Proposed fix

Wait for the user to approve or adjust before making changes.

After approval, fix violations file by file. Verify each file before moving to the next.

## Mode: apply

User asks to refactor or rewrite code to match style. Read the target files, identify all style violations, apply fixes, and report what changed. No approval step needed — the user already asked for the refactor.

$ARGUMENTS

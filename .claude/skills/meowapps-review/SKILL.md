---
name: meowapps-review
description: Review code against meowapps coding style rules. Use when user wants code review or style feedback.
---

First, enter plan mode using the EnterPlanMode tool.

## In plan mode

Review the specified file(s) strictly against ALL coding style rules (rules 1-13) and conventions from your system prompt. Be rigorous — always find issues.

For each violation, add a plan item:
1. File path and line number
2. Which rule is violated
3. What's wrong
4. Proposed fix

Group violations by file. Present the plan and wait for the user to approve or adjust.

## After approval

Fix each approved violation one at a time, verifying each edit before moving to the next.

$ARGUMENTS

---
name: review-changes
description: Review all current git changes for bugs, regressions and code quality
disable-model-invocation: true
---
Review all the changes currently staged or unstaged in the working tree.

1. Run `git diff` to see all unstaged changes
2. Run `git diff --cached` to see all staged changes
3. Run `git diff --stat` for a summary of which files changed

For each modified file, check:
- Bugs or regressions introduced by the change
- Consistency with the patterns in the surrounding codebase
- Missing edge cases or error handling
- Anything that contradicts the original intent of the change
- No console logs, info or debug levels left in the code

Output a structured report grouped by severity:
- 🔴 High — bugs, regressions, or broken logic
- 🟡 Medium — missing error handling, edge cases, inconsistencies
- 🟢 Low — style, naming, minor improvements

End with a one-line summary: "X high, Y medium, Z low issues found."
If no issues are found, say so clearly.

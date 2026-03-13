---
name: write-spec
description: Research a GitHub issue and write a detailed requirements specification as a comment. Run with /write-spec <ISSUE_NUMBER>.
---

# Write Spec — Requirements Specification Writer

This skill researches a GitHub issue in depth and posts a detailed requirements specification as a comment on the issue.

## Step 0: Parse Arguments

The issue number must be provided as an argument. If not provided, ask the user for the issue number and stop.

```
ISSUE_NUMBER=<provided argument>
REPO="nick-pape/grackle"
```

## Step 1: Read the Issue

```bash
gh issue view $ISSUE_NUMBER -R $REPO
```

Capture the title, body, labels, and any referenced issues (parent epics, related issues, sibling tickets).

## Step 2: Read Related Issues

For every issue referenced in the body (parent epics, sibling sub-tasks, related features), read them:

```bash
gh issue view <RELATED_NUMBER> -R $REPO
```

This provides context on how this issue fits into the larger feature.

## Step 3: Read Relevant Specs and RFCs

Check these spec files in the repo for relevant sections:

- `specs/task-orchestration.md` — Orchestration RFC (task lifecycle, decomposition, reconciliation, escalation)
- `specs/GRACKLE-DEEP-DIVE.md` — Full architecture deep dive (all subsystems)
- `specs/v0.md` — Original design spec (UI mockups, interaction patterns)
- `specs/default-personas.md` — Persona roster definitions
- `spec/ux-audit.md` — UX audit findings and recommendations

Read the files that are relevant based on the issue's domain (server, web, CLI, powerline, etc.). Use the issue labels to guide which specs to prioritize.

## Step 4: Read Relevant Source Code

Based on the issue's domain, explore the codebase to understand the current state:

- **Server issues**: `packages/server/src/` — stores, gRPC service, event processor, adapters
- **Web/UX issues**: `packages/web/src/` — components, hooks, routing, existing UI patterns
- **CLI issues**: `packages/cli/src/` — commands, formatters
- **PowerLine issues**: `packages/powerline/src/` — MCP tools, runtimes, adapters
- **Proto issues**: `packages/common/src/proto/` — existing messages, RPCs, enums
- **Common/types**: `packages/common/src/types.ts` — shared type definitions

Use Grep, Glob, and Read to find relevant code. Focus on:
- How the feature's domain currently works
- What data models and APIs already exist
- What's missing vs what's already partially implemented
- Existing test patterns in the affected package

## Step 5: Write the Requirements Specification

Write a comprehensive spec covering these sections. Adapt the sections to the issue type (feature vs bug vs refactor):

### For Features:
- **Overview**: What is this feature and why does it matter? (2-3 sentences)
- **Functional Requirements**: Numbered FR-1, FR-2, etc. Be specific and testable. Describe WHAT, not HOW.
- **Non-Functional Requirements**: Performance, accessibility, reliability, backwards compatibility constraints
- **Integration Points**: How does this interact with existing systems? Reference specific files/modules.
- **Acceptance Criteria — Unit Tests**: What should unit tests verify? Number them UT-1, UT-2, etc.
- **Acceptance Criteria — Integration Tests**: What should integration/E2E tests verify? Number them IT-1, IT-2, etc.
- **Acceptance Criteria — Manual Testing**: Step-by-step procedures a human can follow. Number them MT-1, MT-2, etc.
- **Out of Scope**: What is explicitly NOT part of this ticket? Reference related issues where appropriate.
- **Open Questions**: Unresolved decisions or ambiguities discovered during research. **These are blockers — all open questions must be resolved before implementation begins.** Be specific: state the question, explain why it matters, and suggest options where possible. Number them OQ-1, OQ-2, etc.

### For Bugs:
- **Overview**: What is the bug and what's the user impact?
- **Current Behavior**: Describe exactly what happens now. Reference specific code paths.
- **Expected Behavior**: What should happen instead?
- **Functional Requirements**: Numbered FR-1, FR-2, etc. What must the fix accomplish?
- (Then the same NFR, Integration Points, Acceptance Criteria, Out of Scope, Open Questions sections as above — including the blocker requirement on Open Questions)

### Important Guidelines:
- This is a **REQUIREMENTS** doc, not an implementation plan. Describe WHAT, not HOW.
- Don't prescribe specific classes, file structures, or code patterns — let the implementer decide.
- You CAN reference existing code to describe the current state and integration points.
- For bugs, reference the specific code paths that exhibit the problem.
- Keep it thorough but readable. Use markdown formatting with headers and numbered lists.

## Step 6: Post the Spec as a Comment

Post the spec as a comment on the issue. Use a heredoc to preserve formatting:

```bash
gh issue comment $ISSUE_NUMBER -R $REPO --body "$(cat <<'SPECEOF'
## Requirements Specification

<your spec content here>

SPECEOF
)"
```

## Step 7: Review the Issue Description

Check if the current issue description is thin or missing important context. If so, update it to supplement (not overwrite) the existing content. If the description is already adequate, leave it as-is — the spec comment provides the detail.

## Step 8: Report

Summarize what was done:
- How many functional requirements were defined
- Key findings from the code review (e.g., missing APIs, partially implemented features, existing patterns to leverage)
- Any open questions that need team input

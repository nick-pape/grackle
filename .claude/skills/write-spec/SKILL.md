---
name: write-spec
description: Research a GitHub issue and write a detailed requirements specification into the issue body. Run with /write-spec <ISSUE_NUMBER>.
---

# Write Spec — Requirements Specification Writer

This skill researches a GitHub issue in depth and writes a detailed requirements specification directly into the issue body.

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

- `specs/2026-03-18-agent-kernel.md` — Agent Kernel Architecture RFC (task lifecycle, process model, scheduling, IPC, signals)
- `specs/2026-03-11-grackle-deep-dive.md` — Full architecture deep dive (all subsystems)
- `specs/2026-02-20-v0.md` — Original design spec (UI mockups, interaction patterns)
- `specs/2026-03-13-default-personas.md` — Persona roster definitions
- `specs/2026-03-12-ux-audit.md` — UX audit findings and recommendations

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

## Step 6: Write the Spec into the Issue Body

The spec goes directly into the issue body — NOT as a comment. This ensures agents always see it when reading the issue.

1. Read the current issue body using `mcp__github__issue_read` (method: "get") or `gh issue view`.
2. Build the new body:
   - If the body already contains a `## Requirements Specification` section, **replace** everything from that header to the end of the body with the new spec.
   - Otherwise, **append** the spec after the existing body, separated by `\n\n---\n\n`.
   - If the original body is very thin (< 100 chars) and the spec has an Overview section, replace the body entirely with the spec content.
3. Update the issue body:

```bash
gh issue edit $ISSUE_NUMBER -R $REPO --body "$(cat <<'SPECEOF'
<new body content here>
SPECEOF
)"
```

4. Check if the issue has any existing spec comments (comments starting with `## Requirements Specification` or `# Requirements Specification`). If found, delete them to avoid duplication:

```bash
gh api -X DELETE repos/$REPO/issues/comments/<COMMENT_ID>
```

## Step 7: Add approved-for-grackle Label

If the issue does not already have the `approved-for-grackle` label, add it:

```bash
gh issue edit $ISSUE_NUMBER -R $REPO --add-label approved-for-grackle
```

This marks the issue as spec'd and ready for development.

## Step 8: Report

Summarize what was done:
- How many functional requirements were defined
- Key findings from the code review (e.g., missing APIs, partially implemented features, existing patterns to leverage)
- Any open questions that need team input
- Confirm the spec was written to the issue body (not as a comment)

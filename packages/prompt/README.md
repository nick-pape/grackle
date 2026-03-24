# @grackle-ai/prompt

System prompt assembly and persona resolution for [Grackle](https://github.com/nick-pape/grackle) agent sessions.

## Overview

This package prepares everything an agent session needs before it starts:

- **System prompt building** — `SystemPromptBuilder` assembles prompts from discrete sections based on session type (orchestrator, leaf task, or ad-hoc). Orchestrator tasks get project context, task trees, persona rosters, and decomposition guidelines. Leaf tasks get a completion contract.
- **Orchestrator context** — `fetchOrchestratorContext()` gathers all data needed for orchestrator prompts from the database: workspace metadata, task hierarchy, available personas/environments, and recent findings.
- **Persona resolution** — `resolvePersona()` resolves which persona to use via a cascade: request persona → task default → workspace default → app default.

## Usage

```typescript
import { SystemPromptBuilder, fetchOrchestratorContext, resolvePersona } from "@grackle-ai/prompt";

// Resolve the persona for a session
const resolved = resolvePersona(requestPersonaId, taskDefaultPersonaId, workspaceDefaultPersonaId);

// Fetch orchestrator context (for orchestrator tasks)
const context = fetchOrchestratorContext(workspaceId);

// Build the system prompt
const builder = new SystemPromptBuilder({
  task: { title, description, notes },
  personaPrompt: resolved.systemPrompt,
  canDecompose: task.canDecompose,
  ...context,
});
const systemPrompt = builder.build();
```

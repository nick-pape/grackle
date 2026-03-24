# @grackle-ai/prompt

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/prompt"><img src="https://img.shields.io/npm/v/@grackle-ai/prompt.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

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

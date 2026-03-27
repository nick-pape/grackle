# @grackle-ai/prompt

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/prompt"><img src="https://img.shields.io/npm/v/@grackle-ai/prompt.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

System prompt assembly and persona resolution for [Grackle](https://github.com/nick-pape/grackle) agent sessions.

## Overview

This package is a **pure, zero-dependency** library for building agent session prompts. It has no database or store imports — callers provide pre-fetched data.

- **System prompt building** — `SystemPromptBuilder` assembles prompts from discrete sections based on session type (orchestrator, leaf task, or ad-hoc). Orchestrator tasks get project context, task trees, persona rosters, and decomposition guidelines. Leaf tasks get a completion contract.
- **Orchestrator context** — `buildOrchestratorContext()` transforms pre-fetched data (tasks, personas, environments, findings) into the slim types needed by `SystemPromptBuilder`.
- **Persona resolution** — `resolvePersona()` resolves which persona to use via a cascade: request persona, task default, workspace default, app default. Accepts a lookup function instead of accessing the database directly.

## Usage

```typescript
import {
  SystemPromptBuilder,
  buildOrchestratorContext,
  resolvePersona,
} from "@grackle-ai/prompt";

// Resolve the persona for a session (caller maps DB row to PersonaResolveInput)
const resolved = resolvePersona(
  requestPersonaId,
  taskDefaultPersonaId,
  workspaceDefaultPersonaId,
  appDefaultPersonaId,
  (id) => {
    const row = personaStore.getPersona(id);
    if (!row) return undefined;
    return { id: row.id, name: row.name, runtime: row.runtime, model: row.model,
      maxTurns: row.maxTurns, systemPrompt: row.systemPrompt, toolConfig: row.toolConfig,
      mcpServers: row.mcpServers, type: row.type, script: row.script };
  },
);

// Build orchestrator context from pre-fetched data
const context = buildOrchestratorContext({
  workspace: { name: "My Project", description: "...", repoUrl: "..." },
  tasks: [...],      // TaskInput[]
  personas: [...],   // PersonaInput[]
  environments: [...], // EnvironmentInput[]
  findings: [...],   // FindingInput[]
});

// Build the system prompt
const builder = new SystemPromptBuilder({
  task: { title, description, notes },
  personaPrompt: resolved.systemPrompt,
  canDecompose: task.canDecompose,
  ...context,
});
const systemPrompt = builder.build();
```

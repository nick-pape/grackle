# @grackle-ai/adapter-codespace

Grackle environment adapter for managing GitHub Codespaces.

## Overview

The Codespace adapter provisions PowerLine inside a GitHub Codespace, opens a port-forward tunnel via `gh codespace ports forward`, and a reverse tunnel so remote agents can reach the local MCP server.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `codespaceName` | `string` | *required* | Codespace name from `gh codespace list` |
| `localPort` | `number` | auto | Override local tunnel port |
| `env` | `Record<string, string>` | — | Extra env vars for remote PowerLine |

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- An existing GitHub Codespace

# @grackle-ai/adapter-codespace

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/adapter-codespace"><img src="https://img.shields.io/npm/v/@grackle-ai/adapter-codespace.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

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

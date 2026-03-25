# @grackle-ai/adapter-ssh

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/adapter-ssh"><img src="https://img.shields.io/npm/v/@grackle-ai/adapter-ssh.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Grackle environment adapter for managing remote environments via SSH.

## Overview

The SSH adapter provisions PowerLine on a remote host, opens an SSH tunnel for gRPC communication, and a reverse tunnel so remote agents can reach the local MCP server.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | `string` | *required* | Remote hostname or IP |
| `user` | `string` | current OS user | SSH username |
| `sshPort` | `number` | `22` | SSH port |
| `identityFile` | `string` | — | Path to SSH private key |
| `sshOptions` | `Record<string, string>` | — | Extra SSH `-o Key=Value` options |
| `localPort` | `number` | auto | Override local tunnel port |
| `env` | `Record<string, string>` | — | Extra env vars for remote PowerLine |

## Prerequisites

- SSH access to the remote host (key-based authentication recommended)
- `ssh` and `scp` available on PATH

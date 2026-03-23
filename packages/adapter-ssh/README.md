# @grackle-ai/adapter-ssh

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

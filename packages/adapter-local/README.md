# @grackle-ai/adapter-local

Grackle environment adapter for connecting to a locally-running PowerLine process.

## Overview

The local adapter connects to a PowerLine gRPC server on the same machine. It is the simplest adapter — no tunneling, no remote provisioning.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `7433` | PowerLine port |
| `host` | `string` | `"localhost"` | PowerLine host |

## Prerequisites

- A locally-running PowerLine process (typically managed by the Grackle server)

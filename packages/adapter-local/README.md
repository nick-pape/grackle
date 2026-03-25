# @grackle-ai/adapter-local

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/adapter-local"><img src="https://img.shields.io/npm/v/@grackle-ai/adapter-local.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

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

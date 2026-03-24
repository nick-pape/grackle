# @grackle-ai/github-import

Standalone script to import GitHub issues as Grackle tasks. Uses the Grackle gRPC API to create tasks, so the Grackle server must be running.

## Usage

```bash
# Set required environment variables
export GRACKLE_URL=http://127.0.0.1:7434
export GRACKLE_API_KEY=<your-api-key>

# Import open issues
node dist/import-github-issues.js --workspace <id> --repo owner/repo

# Import with filters
node dist/import-github-issues.js --workspace <id> --repo owner/repo --label "agent-work" --state closed

# Skip issue comments
node dist/import-github-issues.js --workspace <id> --repo owner/repo --no-include-comments
```

## Options

| Option | Description |
|--------|-------------|
| `--workspace <id>` | Grackle workspace ID (required) |
| `--repo <owner/repo>` | GitHub repository (required) |
| `--label <label>` | Filter issues by label |
| `--state <state>` | Issue state: `open` (default) or `closed` |
| `--no-include-comments` | Exclude issue comments from task descriptions |

## Prerequisites

- `gh` CLI authenticated with access to the target repository
- A running Grackle server with `GRACKLE_URL` and `GRACKLE_API_KEY` set

## What it does

1. Fetches issues from GitHub via `gh api graphql` (with pagination)
2. Deduplicates against existing tasks (by `#<number>:` title pattern)
3. Topologically sorts issues (parents before children)
4. Creates tasks via gRPC, preserving parent-child relationships
5. Sets blocking dependencies between tasks

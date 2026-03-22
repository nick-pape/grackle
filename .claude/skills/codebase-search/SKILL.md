---
name: codebase-search
description: Search the codebase by concept using semantic search, then drill into results with Grep/Read. Use when exploring unfamiliar code, tracing behavior, or answering "how does X work?" questions.
argument-hint: "<search query>"
---

# Codebase Search

Search the codebase using semantic search (concept/intent-based) backed by the `qdrant-search` MCP server, then drill into results with targeted Grep/Read.

**Query**: $ARGUMENTS

## When to Use This

- "How does authentication work?"
- "Where is session reconnection handled?"
- "What happens when an environment disconnects?"
- Any question about behavior, flow, or intent — not exact symbol names

## Search Strategy

### Step 1: Semantic search

Use `mcp__qdrant-search__semantic_search` with the user's query. Always scope to the current catalog.

```
mcp__qdrant-search__semantic_search(query: "<user's question>", catalog: "<folder-name>")
```

Review the results — they're ranked by relevance with breadcrumbs showing the code path.

#### Examples

**Conceptual question** — "how does the pairing flow work?"
```
mcp__qdrant-search__semantic_search(query: "pairing code generation and redemption flow", catalog: "<folder-name>")
```

**Tracing behavior** — "what happens when an agent session completes?"
```
mcp__qdrant-search__semantic_search(query: "session completion event processing status transition", catalog: "<folder-name>")
```

**Finding related code** — "where are tokens injected into sessions?"
```
mcp__qdrant-search__semantic_search(query: "token injection push credentials to PowerLine before spawn", catalog: "<folder-name>")
```

**Cross-cutting concern** — "how does error handling work across the WebSocket bridge?"
```
mcp__qdrant-search__semantic_search(query: "WebSocket error handling disconnect reconnection", catalog: "<folder-name>")
```

### Step 2: View top results

Use `mcp__qdrant-search__view_chunks` to read the full source of the most relevant hits (top 3-5). Use selectors to get specific chunks:

```
mcp__qdrant-search__view_chunks(ids: ["abc123"])       // all chunks for that file
mcp__qdrant-search__view_chunks(ids: ["abc123:2-4"])   // chunks 2 through 4
mcp__qdrant-search__view_chunks(ids: ["abc123:3"])     // single chunk
```

#### Example

Semantic search returns a hit `f7a2b3c1:2` with breadcrumb `@grackle-ai/server > src > pairing.ts > redeemPairingCode`. To read the full function:

```
mcp__qdrant-search__view_chunks(ids: ["f7a2b3c1:2-3"])
```

### Step 3: Follow references with Grep/Read

Once you've identified the key files from semantic search, use Grep to find exact symbol references and Read to examine specific implementations. Semantic search finds the *area*, Grep/Read finds the *details*.

#### Example

Semantic search found that `redeemPairingCode` in `pairing.ts` is the core function. Now trace who calls it:

```
Grep: pattern="redeemPairingCode" → finds call sites across the server package
Read: the relevant handler file to see how the gRPC/HTTP layer invokes it
```

### Step 4: Synthesize

Report findings with specific file paths and line numbers. Connect the dots between components.

## When NOT to Use This

Use Grep/Glob directly when you:
- Know the exact symbol name: `Grep: pattern="class SessionStore"`
- Need a regex pattern: `Grep: pattern="status.*=.*completed"`
- Are looking for a specific file: `Glob: pattern="**/pairing.ts"`

## Rules

1. **Always start with semantic search** — don't skip to Grep for conceptual questions
2. **Always scope to this clone's catalog** — use the repo folder name (e.g., `grackle6` for `~/src/grackle6/`). Run `basename $(git rev-parse --show-toplevel)` if unsure.
3. **Use Grep for follow-up, not initial discovery** — Grep finds exact strings, semantic search finds concepts
4. **Include file:line references** in your response
5. **Run multiple semantic searches if needed** — different phrasings surface different results. If the first query doesn't find what you need, rephrase.

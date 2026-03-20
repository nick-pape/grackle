# rush-qdrant Chunker Test Results — Grackle Monorepo

**Date**: 2026-03-19
**Tool**: [octogonz/rush-qdrant-prototype](https://github.com/octogonz/rush-qdrant-prototype)
**Tested against**: [nick-pape/grackle@d6f1581](https://github.com/nick-pape/grackle/commit/d6f158144ef2262854c8572254708229515c6d80)

## Summary

| Metric | Value |
|--------|-------|
| Files scanned | 550 |
| Chunks indexed | 878 |
| Total crawl time | ~8 min (CPU, 1.8 chunks/sec) |
| **Chunking warnings** | **16 files** (4 non-committed artifacts, **12 real**) |

## Non-committed / build artifacts (should be excluded from indexing)

These 4 files triggered warnings but are gitignored or build outputs:

- `packages/common/src/gen/grackle/grackle_pb.ts` — protobuf generated (gitignored)
- `packages/common/dist/gen/grackle/grackle_pb.d.ts` — dist build output (gitignored)
- `packages/server/dist/schema.d.ts` — dist build output (gitignored)
- `packages/common/src/gen/grackle/grackle_pb.ts` — protobuf generated (gitignored)

**Fix applied**: Updated `config.rs` to exclude `/src/gen/` and always exclude `/dist/` (previously had a `src/`/`test/` exception).

## Real chunking failures (12 files, 4 root causes)

### Root Cause 1: Single exported array literal (5 files)

The partitioner sees `export const tools: ToolDefinition[] = [ ... ];` as one top-level expression statement. There are no function/class/interface boundaries to split at — the entire file body is a single array of object literals.

| File | Array span |
|------|-----------|
| [`mcp/src/tools/env.ts` L9–277](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/mcp/src/tools/env.ts#L9-L277) | `envTools: ToolDefinition[]` |
| [`mcp/src/tools/task.ts` L24–409](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/mcp/src/tools/task.ts#L24-L409) | `taskTools: ToolDefinition[]` |
| [`mcp/src/tools/session.ts` L24–259](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/mcp/src/tools/session.ts#L24-L259) | `sessionTools: ToolDefinition[]` |
| [`mcp/src/tools/persona.ts` L38–193](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/mcp/src/tools/persona.ts#L38-L193) | `personaTools: ToolDefinition[]` |
| [`mcp/src/tools/workspace.ts` L9–258](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/mcp/src/tools/workspace.ts#L9-L258) | `workspaceTools: ToolDefinition[]` |

**Suggested fix**: Add `array` as a **split scope** in the partitioner so it can split between array element boundaries (the object literals inside `[...]`).

### Root Cause 2: Large single-function React components (5 files)

Each file is dominated by one big `export function Component()` returning complex JSX. The partitioner splits between top-level functions, but inside the component body the `return (...)` is a single expression with no AST split points.

| File | Component | Line |
|------|-----------|------|
| [`UnifiedBar.tsx` L47](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/web/src/components/layout/UnifiedBar.tsx#L47) | `UnifiedBar` | 622 lines |
| [`WorkspaceList.tsx` L386](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/web/src/components/lists/WorkspaceList.tsx#L386) | `WorkspaceList` | 763 lines |
| [`PersonaManager.tsx` L7](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/web/src/components/personas/PersonaManager.tsx#L7) | `PersonaManager` | ~320 lines |
| [`WorkspacePage.tsx` L45](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/web/src/pages/WorkspacePage.tsx#L45) | `WorkspacePage` | ~553 lines |
| [`MockGrackleProvider.tsx` L65](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/web/src/mocks/MockGrackleProvider.tsx#L65) | `MockGrackleProvider` | ~955 lines |

**Suggested fix**: Add `jsx_element` / `jsx_expression` as split scopes or transparent conduits. Also, `if (...)` branches returning JSX are natural split candidates — each early-return block is semantically independent.

### Root Cause 3: Giant unsplittable template literal (1 file)

[`server/src/db.ts` — `initDatabase()` at L71](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/server/src/db.ts#L71) contains a [108-line `sqlite.exec()` template literal](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/server/src/db.ts#L108-L219) with all the CREATE TABLE DDL. The partitioner *can* split between the many `try { sqlite.exec(...) } catch {}` migration blocks (and does), but the initial DDL block exceeds the target size as a single expression.

**Assessment**: Fundamentally unsplittable by an AST chunker. The fallback split is acceptable here. Template literals containing embedded SQL/DDL are a known limitation.

### Root Cause 4: Large type interface + composition hook (1 file)

[`useGrackleSocket.ts` L45–191](https://github.com/nick-pape/grackle/blob/d6f158144ef2262854c8572254708229515c6d80/packages/web/src/hooks/useGrackleSocket.ts#L45-L191) — A 147-line `UseGrackleSocketResult` interface. The interface body is an `object_type` which should be a split scope, but the property groups may be too small to meet minimum chunk size constraints.

**Suggested fix**: Tune minimum chunk size constraints for type-heavy files, or allow degraded splits for large interfaces.

## Priority summary for partitioner improvements

| Priority | Root Cause | Files | Suggested change |
|----------|-----------|-------|-----------------|
| **High** | Array literal splitting | 5 MCP tool files | Add `array` as a split scope |
| **High** | JSX splitting | 5 React component files | Add JSX nodes as split scopes/conduits |
| **Low** | Giant template literals | `db.ts` | Accept fallback — fundamentally unsplittable |
| **Low** | Large interface types | `useGrackleSocket.ts` | Tune min-chunk constraints |

## Environment notes

- **Platform**: Windows (MSYS2/Git Bash) with MSVC Rust toolchain
- **ONNX Runtime**: Required `load-dynamic` feature flag due to MSVC STL link errors with static `download-binaries`; placed `onnxruntime.dll` v1.23.0 next to the binary
- **Windows path fix**: Added `path.replace('\\', "/")` at top of `should_skip_path()` — backslash paths from `walkdir` on Windows didn't match the forward-slash exclusion rules
